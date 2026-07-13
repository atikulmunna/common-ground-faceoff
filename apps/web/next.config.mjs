import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
