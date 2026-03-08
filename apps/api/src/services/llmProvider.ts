import { Mistral } from "@mistralai/mistralai";
import OpenAI from "openai";

export interface LlmResponse {
  content: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

interface ProviderConfig {
  name: string;
  model: string;
  call: (systemPrompt: string, userPrompt: string) => Promise<LlmResponse>;
}

function buildProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  if (process.env.MISTRAL_API_KEY) {
    const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
    const model = "mistral-large-latest";
    providers.push({
      name: "mistral",
      model,
      call: async (systemPrompt, userPrompt) => {
        const res = await client.chat.complete({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          maxTokens: 4096,
        });
        const choice = res.choices?.[0];
        return {
          content: (typeof choice?.message?.content === "string" ? choice.message.content : "") || "",
          provider: "mistral",
          model,
          promptTokens: res.usage?.promptTokens ?? 0,
          completionTokens: res.usage?.completionTokens ?? 0,
        };
      },
    });
  }

  if (process.env.GROQ_API_KEY) {
    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
    const model = "llama-3.3-70b-versatile";
    providers.push({
      name: "groq",
      model,
      call: async (systemPrompt, userPrompt) => {
        const res = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        });
        const choice = res.choices[0];
        return {
          content: choice?.message?.content ?? "",
          provider: "groq",
          model,
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
        };
      },
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
    const model = "google/gemini-2.0-flash-001";
    providers.push({
      name: "openrouter",
      model,
      call: async (systemPrompt, userPrompt) => {
        const res = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        });
        const choice = res.choices[0];
        return {
          content: choice?.message?.content ?? "",
          provider: "openrouter",
          model,
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
        };
      },
    });
  }

  return providers;
}

const MAX_RETRIES = 2;
const LLM_CALL_TIMEOUT_MS = 60_000;

/** CG-NFR39: Per-call timeout wrapper */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms)
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
 * Call an LLM with automatic failover across configured providers.
 * Tries each provider in order (Mistral → Groq → OpenRouter), retrying up to
 * MAX_RETRIES times per provider with capped exponential backoff.
 */
export async function callLlm(
  systemPrompt: string,
  userPrompt: string
): Promise<LlmResponse> {
  const providers = buildProviders();
  if (providers.length === 0) {
    throw new Error("No LLM provider configured. Set at least one of MISTRAL_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.");
  }

  const errors: string[] = [];

  for (const provider of providers) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await withTimeout(provider.call(systemPrompt, userPrompt), LLM_CALL_TIMEOUT_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name} attempt ${attempt + 1}: ${msg}`);
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** attempt, 8000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
  }

  throw new Error(`All LLM providers failed:\n${errors.join("\n")}`);
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
