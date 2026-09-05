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

const apiVersion = gateway.match(/version\s*:\s*\"([^\"]+)\"/)?.[1] ?? null;
const engineVersion = gateway.match(/engine\s*:\s*\"([^\"]+)\"/)?.[1] ?? null;
const billingVersion = gateway.match(/billing\s*:\s*\"([^\"]+)\"/)?.[1] ?? null;
const authVersion = gateway.match(/auth\s*:\s*\"([^\"]+)\"/)?.[1] ?? null;
if (!apiVersion || !engineVersion || !billingVersion || !authVersion) {
  throw new Error("Gateway version contract is missing");
}

const assertions = [
  [index.includes("window.location.href=u.href"), "checkout must navigate directly to the validated Razorpay URL"],
  [index.includes("https://momentum-api-public.manikandanruki2004.workers.dev"), "demo must target the production gateway"],
  [index.includes("/billing/status"), "demo must expose billing status reconciliation"],
  [claude.includes("Every outbound network call has a bounded timeout"), "reliability rule missing from CLAUDE.md"],
  [claude.includes("Make retryable mutations idempotent"), "idempotency rule missing from CLAUDE.md"],
  [architecture.includes("successful Razorpay subscription creation must return"), "billing invariant missing from architecture"],
  [provider.includes("getSubscription(subscriptionId: string)"), "provider read interface missing"],
  [provider.includes("const maxAttempts = retryableRead ? 3 : 1"), "provider read retry policy missing"],
  [provider.includes("const attemptTimeoutMs = retryableRead ? this.readTimeoutMs : this.timeoutMs"), "provider read timeout budget missing"],
  [provider.includes("method: \"POST\""), "provider subscription creation path missing"],
  [billing.includes("/billing/status") && billing.includes("provider.getSubscription(sid)"), "authenticated billing status reconciliation missing"],
  [gateway.includes("/billing/status") && gateway.includes("isBillingStatus") && gateway.includes("binding=env.BILLING"), "gateway must route billing status to the billing service"],
  [openapi.includes("  /billing/status:"), "OpenAPI must document billing status"],
  [openapi.includes(`version: ${apiVersion}`) && openapi.includes(`engine: ${engineVersion}`) && openapi.includes(`billing: ${billingVersion}`) && openapi.includes(`auth: ${authVersion}`), "OpenAPI version contract must match the gateway contract"],
];

for (const [ok, message] of assertions) {
  if (!ok) throw new Error(message);
}

console.log(`Momentum engineering contract checks passed (API ${apiVersion}, engine ${engineVersion}, billing ${billingVersion}, auth ${authVersion}).`);
