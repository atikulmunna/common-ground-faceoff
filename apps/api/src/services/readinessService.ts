import { prisma } from "../lib/prisma.js";

export type DependencyStatus = "ok" | "unavailable";

export type ReadinessResult = {
  ready: boolean;
  checks: {
    database: DependencyStatus;
  };
};

type ReadinessDependencies = {
  checkDatabase: () => Promise<void>;
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

/** The API is ready when Postgres answers; it is also the analysis queue. */
export async function checkReadiness(
  dependencies: ReadinessDependencies = { checkDatabase },
): Promise<ReadinessResult> {
  const database: DependencyStatus = await withTimeout(dependencies.checkDatabase).then(
    () => "ok" as const,
    () => "unavailable" as const,
  );

  return { ready: database === "ok", checks: { database } };
}
