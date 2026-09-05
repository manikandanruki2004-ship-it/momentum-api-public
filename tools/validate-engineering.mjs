import { readFileSync, existsSync } from "node:fs";

const required = [
  "CLAUDE.md",
  "docs/ARCHITECTURE.md",
  "docs/ENGINEERING-CHECKLIST.md",
  "docs/PLAN-V2.md",
  "skills/secure-saas-build/SKILL.md",
  "demo/index.html",
];

for (const path of required) {
  if (!existsSync(path)) throw new Error(`Missing required project artifact: ${path}`);
}

const index = readFileSync("demo/index.html", "utf8");
const claude = readFileSync("CLAUDE.md", "utf8");
const architecture = readFileSync("docs/ARCHITECTURE.md", "utf8");

const assertions = [
  [index.includes("window.location.href = parsed.href"), "checkout must navigate directly to the validated Razorpay URL"],
  [index.includes("https://momentum-api-public.manikandanruki2004.workers.dev"), "demo must target the production gateway"],
  [claude.includes("Every outbound network call has a bounded timeout"), "reliability rule missing from CLAUDE.md"],
  [claude.includes("Make retryable mutations idempotent"), "idempotency rule missing from CLAUDE.md"],
  [architecture.includes("successful Razorpay subscription creation must return"), "billing invariant missing from architecture"],
];

for (const [ok, message] of assertions) {
  if (!ok) throw new Error(message);
}

console.log("Momentum engineering contract checks passed.");
