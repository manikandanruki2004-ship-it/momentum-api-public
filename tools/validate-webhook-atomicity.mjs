import fs from "node:fs";

const billing = fs.readFileSync("billing/src/index.ts", "utf8");
const checklist = fs.readFileSync("docs/ENGINEERING-CHECKLIST.md", "utf8");

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
  [processEvent, "await attachSubscription", "webhook event processing routes customer attachment through the atomic helper"],
]) {
  if (!text.includes(needle)) throw new Error(`Webhook atomicity check failed: ${description}`);
}

if (!/Wrap multi-record entitlement transitions in an atomic unit/.test(checklist)) {
  throw new Error("Checklist must document the entitlement atomicity requirement.");
}

console.log("Webhook atomicity contract checks passed.");
