import { readFileSync, existsSync } from "node:fs";

const billing = readFileSync("billing/src/index.ts", "utf8");
const provider = readFileSync("billing/src/provider.ts", "utf8");
const migration = readFileSync("worker/migrations/0016_razorpay_checkout_attempts.sql", "utf8");

const required = [
  [billing, 'import { RazorpayProvider', 'billing imports the provider adapter'],
  [billing, 'acquireCheckoutLease', 'billing has a per-customer checkout lease'],
  [billing, 'CHECKOUT_IN_PROGRESS', 'billing exposes concurrent-checkout protection'],
  [billing, 'checkout_url', 'billing can reuse an existing provider checkout URL'],
  [billing, 'await storeUnclaimed(env, data.id', 'billing preserves the checkout response before best-effort persistence'],
  [provider, 'export interface BillingProvider', 'provider interface exists'],
  [provider, 'AbortController', 'provider calls have an explicit timeout'],
  [migration, 'CREATE TABLE IF NOT EXISTS razorpay_checkout_attempts', 'checkout attempt state is persisted'],
  [migration, 'customer_id TEXT PRIMARY KEY', 'customer checkout lease is unique per customer'],
];

for (const [text, needle, description] of required) {
  if (!text.includes(needle)) throw new Error(`Billing design check failed: ${description}`);
}

for (const path of [
  ".github/workflows/db-migrations.yml",
  ".github/workflows/release-gate.yml",
  "docs/PLAN-V2.md",
  "docs/ENGINEERING-CHECKLIST.md",
]) {
  if (!existsSync(path)) throw new Error(`Required release artifact missing: ${path}`);
}

console.log("Billing architecture checks passed.");
