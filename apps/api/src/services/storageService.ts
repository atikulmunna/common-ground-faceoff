import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { withRetryBudget } from "./llmProvider.js";

/* ------------------------------------------------------------------ */
/*  Cloudflare R2 Export Storage Service                                */
/*  Uploads exported session artifacts (PDF, Markdown, JSON) to R2.    */
/*  R2 is S3-compatible, so we use the standard AWS SDK.               */
/*  Gracefully degrades when credentials are not configured.           */
/*                                                                     */
/*  Required env vars:                                                 */
/*    R2_BUCKET          — bucket name                                 */
/*    R2_ACCOUNT_ID      — Cloudflare account ID                       */
/*    R2_ACCESS_KEY_ID   — R2 API token access key                     */
/*    R2_SECRET_ACCESS_KEY — R2 API token secret key                   */
/* ------------------------------------------------------------------ */

const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

let r2Client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!R2_BUCKET || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

export function isR2Configured(): boolean {
  return !!(R2_BUCKET && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

/**
 * Upload an export artifact to Cloudflare R2.
 * Returns the R2 key on success, or null if R2 is not configured.
 */
export async function uploadExport(opts: {
  sessionId: string;
  format: string;
  content: Buffer | string;
  contentType: string;
}): Promise<{ key: string; bucket: string } | null> {
  const client = getClient();
  if (!client || !R2_BUCKET) {
    console.warn("[R2] Cloudflare R2 not configured — skipping upload");
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `exports/${opts.sessionId}/${timestamp}.${opts.format}`;

  // CG-NFR39: Bounded retry with 20s total budget
  await withRetryBudget(
    () => client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: typeof opts.content === "string" ? Buffer.from(opts.content, "utf-8") : opts.content,
        ContentType: opts.contentType,
      }),
    ),
    { budgetMs: 20_000, label: "r2-upload" }
  );

  return { key, bucket: R2_BUCKET };
}

/**
 * Retrieve a previously uploaded export from Cloudflare R2.
 * Returns the readable stream or null if not found / not configured.
 */
export async function getExport(key: string): Promise<{
  body: ReadableStream | null;
  contentType: string | undefined;
} | null> {
  const client = getClient();
  if (!client || !R2_BUCKET) return null;

  const result = await client.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }),
  );

  return {
    body: result.Body?.transformToWebStream() ?? null,
    contentType: result.ContentType,
  };
}
