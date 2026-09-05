import fs from "node:fs";

const billing = fs.readFileSync("billing/src/index.ts", "utf8");
const checklist = fs.readFileSync("docs/ENGINEERING-CHECKLIST.md", "utf8");
const triggerMigration = fs.readFileSync("worker/migrations/0019_rebuild_billing_entitlement_sync_triggers.sql", "utf8");

function bodyOf(name) {
  const start = billing.indexOf(`async function ${name}`);
  if (start < 0) throw new Error(`Missing function: ${name}`);
  const next = billing.indexOf("\nasync function ", start + 1);
  return billing.slice(start, next < 0 ? billing.length : next);
}

const attach = bodyOf("attachSubscription");
const processEvent = bodyOf("processEvent");

for (const [text, needle, description] of [
  [attach, "env.DB.batch([", "subscription attachment uses a transactional D1 batch"],
  [attach, "UPDATE razorpay_unclaimed_subscriptions", "subscription claim state is updated during attachment"],
  [attach, "UPDATE customers SET tier='pro'", "new-subscription attachment updates entitlement in the same transaction"],
  [processEvent, "await attachSubscription", "webhook event processing routes customer attachment through the atomic helper"],
]) {
  if (!text.includes(needle)) throw new Error(`Webhook atomicity check failed: ${description}`);
}

for (const needle of [
  "DROP TRIGGER IF EXISTS trg_sync_customer_entitlement_insert",
  "CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_insert",
  "CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_update",
  "status IN ('active','pending','halted','paused')",
]) {
  if (!triggerMigration.includes(needle)) throw new Error(`D1 entitlement trigger guard missing: ${needle}`);
}

if (!/Multi-record entitlement transitions use D1 atomic batches/.test(checklist)) {
  throw new Error("Checklist must document the entitlement atomicity requirement.");
}

console.log("Webhook atomicity contract checks passed.");
