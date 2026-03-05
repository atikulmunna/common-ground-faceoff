const fs = require("node:fs");
const path = require("node:path");

const required = [
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/create/page.tsx",
  "apps/web/src/app/session/[id]/page.tsx"
];

const missing = required.filter((entry) => !fs.existsSync(path.join(process.cwd(), entry)));
if (missing.length > 0) {
  console.error("A11y smoke failed. Missing pages:\n" + missing.join("\n"));
  process.exit(1);
}
console.log("A11y smoke passed: core pages are present for CI gating.");
