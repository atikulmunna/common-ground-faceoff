import Redis from "ioredis";

import { prisma } from "../lib/prisma.js";

export type DependencyStatus = "ok" | "unavailable" | "not_configured";

export type ReadinessResult = {
  ready: boolean;
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
};

type ReadinessDependencies = {
  checkDatabase: () => Promise<void>;
  checkRedis?: () => Promise<void>;
};

const CHECK_TIMEOUT_MS = 2_000;

async function withTimeout(check: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Readiness check timed out")), CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

async function checkRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: CHECK_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    await client.ping();
  } finally {
    client.disconnect();
  }
}

export async function checkReadiness(
  dependencies: ReadinessDependencies = {
    checkDatabase,
    ...(process.env.REDIS_URL ? { checkRedis } : {}),
  },
): Promise<ReadinessResult> {
  const checks: ReadinessResult["checks"] = {
    database: "unavailable",
    redis: dependencies.checkRedis ? "unavailable" : "not_configured",
  };

  await Promise.all([
    withTimeout(dependencies.checkDatabase)
      .then(() => { checks.database = "ok"; })
      .catch(() => { checks.database = "unavailable"; }),
    dependencies.checkRedis
      ? withTimeout(dependencies.checkRedis)
          .then(() => { checks.redis = "ok"; })
          .catch(() => { checks.redis = "unavailable"; })
      : Promise.resolve(),
  ]);

  return {
    ready: checks.database === "ok" &&
      (checks.redis === "ok" || checks.redis === "not_configured"),
    checks,
  };
}
