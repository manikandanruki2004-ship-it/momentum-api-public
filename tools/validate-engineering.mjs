import { readFileSync, existsSync } from "node:fs";

const required = [
  "CLAUDE.md",
  "docs/ARCHITECTURE.md",
  "docs/ENGINEERING-CHECKLIST.md",
  "docs/PLAN-V2.md",
  "skills/secure-saas-build/SKILL.md",
  "demo/index.html",
  "billing/src/index.ts",
  "billing/src/provider.ts",
  "worker/src/index.ts",
  "openapi.yaml",
];

for (const path of required) {
  if (!existsSync(path)) throw new Error(`Missing required project artifact: ${path}`);
}

const index = readFileSync("demo/index.html", "utf8");
const claude = readFileSync("CLAUDE.md", "utf8");
const architecture = readFileSync("docs/ARCHITECTURE.md", "utf8");
const billing = readFileSync("billing/src/index.ts", "utf8");
const gateway = readFileSync("worker/src/index.ts", "utf8");
const provider = readFileSync("billing/src/provider.ts", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

const assertions = [
  [index.includes("window.location.href=u.href"), "checkout must navigate directly to the validated Razorpay URL"],
  [index.includes("https://momentum-api-public.manikandanruki2004.workers.dev"), "demo must target the production gateway"],
  [index.includes("/billing/status"), "demo must expose billing status reconciliation"],
  [claude.includes("Every outbound network call has a bounded timeout"), "reliability rule missing from CLAUDE.md"],
  [claude.includes("Make retryable mutations idempotent"), "idempotency rule missing from CLAUDE.md"],
  [architecture.includes("successful Razorpay subscription creation must return"), "billing invariant missing from architecture"],
  [provider.includes("getSubscription(subscriptionId: string)"), "provider read interface missing"],
  [billing.includes("/billing/status") && billing.includes("provider.getSubscription(sid)"), "authenticated billing status reconciliation missing"],
  [gateway.includes("/billing/status") && gateway.includes("isBillingStatus") && gateway.includes("binding=env.BILLING"), "gateway must route billing status to the billing service"],
  [openapi.includes("  /billing/status:"), "OpenAPI must document billing status"],
  [openapi.includes("version: 1.7.0") && openapi.includes("engine: 1.3.1") && openapi.includes("billing: 1.3.1") && openapi.includes("auth: 1.2.0"), "OpenAPI version contract must match deployed service versions"],
  [!openapi.includes("tier: { type: string, enum: [free, starter, pro] }"), "OpenAPI must not advertise the removed starter tier in the active product contract"],
];

for (const [ok, message] of assertions) {
  if (!ok) throw new Error(message);
}

console.log("Momentum engineering contract checks passed.");
