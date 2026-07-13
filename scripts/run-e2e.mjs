import { spawn, spawnSync } from "node:child_process";

const containerName = "common-ground-e2e-postgres";
const databaseUrl = "postgresql://postgres:e2e_test_password@127.0.0.1:55433/common_ground_e2e_test?schema=public";
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run browser E2E tests through npm run test:e2e");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function dockerContainerExists() {
  const result = spawnSync("docker", ["ps", "-a", "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Docker is required to run browser E2E tests");
  return result.stdout.trim() === containerName;
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres", "-d", "common_ground_e2e_test"], {
      stdio: "ignore",
    });
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Temporary E2E PostgreSQL did not become ready");
}

function cleanup() {
  spawnSync("docker", ["stop", containerName], { stdio: "ignore" });
}

if (dockerContainerExists()) {
  throw new Error(`Refusing to reuse existing Docker container ${containerName}`);
}

try {
  run("docker", [
    "run", "--rm", "-d",
    "--name", containerName,
    "-e", "POSTGRES_PASSWORD=e2e_test_password",
    "-e", "POSTGRES_DB=common_ground_e2e_test",
    "-p", "127.0.0.1:55433:5432",
    "postgres:16-alpine",
  ]);
  await waitForPostgres();

  const env = { ...process.env, DATABASE_URL: databaseUrl, E2E_DATABASE_URL: databaseUrl };
  run(process.execPath, [npmCli, "exec", "--", "prisma", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env });

  const playwright = spawn(process.execPath, [npmCli, "exec", "--", "playwright", "test"], {
    stdio: "inherit",
    env,
  });
  const exitCode = await new Promise((resolve, reject) => {
    playwright.on("error", reject);
    playwright.on("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  cleanup();
}
