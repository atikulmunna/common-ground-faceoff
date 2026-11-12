import OpenAI from "openai";

export interface LlmResponse {
  content: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-120b";
/** The SDK aborts the HTTP request when this elapses. */
const LLM_CALL_TIMEOUT_MS = 60_000;
/** The SDK retries 408/409/429/5xx, timeouts, and connection errors with backoff; other 4xx fail fast. */
const LLM_TRANSPORT_RETRIES = 2;
/** Fresh completions to request when the model's output fails validation. */
const LLM_INVALID_OUTPUT_RETRIES = 2;

/** Default retry count for withRetryBudget (email and storage calls). */
const MAX_RETRIES = 2;

/** CG-NFR39: Per-call timeout wrapper */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Call timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * CG-NFR39: Third-party call with bounded retry + total timeout budget.
 * Max 2 retries, capped exponential backoff, total budget ≤ budgetMs.
 */
export async function withRetryBudget<T>(
  fn: () => Promise<T>,
  opts: { budgetMs?: number; maxRetries?: number; label?: string } = {}
): Promise<T> {
  const budget = opts.budgetMs ?? 20_000;
  const retries = opts.maxRetries ?? MAX_RETRIES;
  const label = opts.label ?? "third-party";
  const start = Date.now();
  const errors: string[] = [];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const remaining = budget - (Date.now() - start);
    if (remaining <= 0) break;
    try {
      return await withTimeout(fn(), remaining);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${label} attempt ${attempt + 1}: ${msg}`);
      if (attempt < retries) {
        const delay = Math.min(1000 * 2 ** attempt, 4000);
        const waitRemaining = budget - (Date.now() - start);
        if (delay >= waitRemaining) break;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`${label} failed (budget ${budget}ms):\n${errors.join("\n")}`);
}

/**
 * Call the configured OpenRouter model. Transport failures are retried by the
 * SDK, so a thrown request error is final. Output rejected by `validate` is
 * requested again, because malformed JSON from a model is usually transient.
 */
export async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  validate?: (content: string) => void,
): Promise<LlmResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("No LLM provider configured. Set OPENROUTER_API_KEY.");
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    timeout: LLM_CALL_TIMEOUT_MS,
    maxRetries: LLM_TRANSPORT_RETRIES,
  });

  const maxAttempts = LLM_INVALID_OUTPUT_RETRIES + 1;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });

    const response: LlmResponse = {
      content: res.choices[0]?.message?.content ?? "",
      provider: "openrouter",
      // OpenRouter reports the model that served the request, which is what lineage should record.
      model: res.model || model,
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    };

    try {
      validate?.(response.content);
      return response;
    } catch (err) {
      errors.push(`attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`OpenRouter returned invalid output after ${maxAttempts} attempts:\n${errors.join("\n")}`);
}

/**
 * Parse a JSON block from LLM output. Tolerates markdown fences and
 * control characters that LLMs sometimes emit inside string values.
 */
export function parseJsonResponse<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1].trim() : raw.trim();

  const attempts = [
    () => JSON.parse(text) as T,
    () => {
      // Escape unescaped control chars inside JSON string values only
      const sanitized = text.replace(
        /"(?:[^"\\]|\\.)*"/g,
        (str) =>
          str.replace(/[\x00-\x1f]/g, (ch) => {
            if (ch === "\n") return "\\n";
            if (ch === "\r") return "\\r";
            if (ch === "\t") return "\\t";
            return "";
          })
      );
      return JSON.parse(sanitized) as T;
    },
    () => {
      // Try to repair truncated JSON by closing open brackets/braces/strings
      let repaired = text.replace(
        /"(?:[^"\\]|\\.)*"/g,
        (str) =>
          str.replace(/[\x00-\x1f]/g, (ch) => {
            if (ch === "\n") return "\\n";
            if (ch === "\r") return "\\r";
            if (ch === "\t") return "\\t";
            return "";
          })
      );
      // Remove trailing comma before we close
      repaired = repaired.replace(/,\s*$/, "");
      // Close any unclosed strings
      const quoteCount = (repaired.match(/(?<!\\)"/g) ?? []).length;
      if (quoteCount % 2 !== 0) repaired += '"';
      // Close unclosed brackets/braces
      const opens = { "{": 0, "[": 0 };
      const closes: Record<string, keyof typeof opens> = { "}": "{", "]": "[" };
      for (const ch of repaired) {
        if (ch in opens) opens[ch as keyof typeof opens]++;
        if (ch in closes) opens[closes[ch]]--;
      }
      for (let i = 0; i < opens["["]; i++) repaired += "]";
      for (let i = 0; i < opens["{"]; i++) repaired += "}";
      return JSON.parse(repaired) as T;
    },
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      return attempts[i]();
    } catch (err) {
      if (i === attempts.length - 1) throw err;
    }
  }

  throw new Error("Failed to parse JSON response");
}
