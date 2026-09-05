import fs from 'node:fs';

const dir = 'worker/migrations';
const files = fs.readdirSync(dir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (!files.length) throw new Error('No numbered D1 migrations found.');

const prefixes = files.map(name => Number(name.slice(0, 4)));
if (prefixes[0] < 8) {
  throw new Error(`Unexpected D1 migration baseline: found ${files[0].slice(0, 4)}.`);
}
for (let i = 1; i < prefixes.length; i++) {
  if (prefixes[i] < prefixes[i - 1]) {
    throw new Error(`D1 migration ordering regression: ${files[i - 1]} -> ${files[i]}.`);
  }
}

const required = [
  ['0010_razorpay_current_subscription.sql', 'current-subscription invariant migration'],
  ['0016_razorpay_checkout_attempts.sql', 'checkout lease migration'],
  ['0017_auth_rate_limit.sql', 'auth rate-limit migration'],
  ['0018_billing_entitlement_sync_triggers.sql', 'billing entitlement trigger migration'],
  ['0019_rebuild_billing_entitlement_sync_triggers.sql', 'billing entitlement trigger rebuild migration'],
  ['0020_rebuild_billing_entitlement_active_state.sql', 'billing entitlement active-state repair migration'],
];

for (const [name, description] of required) {
  if (!files.includes(name)) throw new Error(`Missing ${description}: ${name}`);
}

const triggerMigration = fs.readFileSync(`${dir}/0020_rebuild_billing_entitlement_active_state.sql`, 'utf8');
for (const needle of [
  'DROP TRIGGER IF EXISTS trg_sync_customer_entitlement_insert',
  'CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_insert',
  'CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_update',
  'CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_delete',
  "status IN ('active','pending','halted','paused')",
  "status = 'active'",
  "THEN 0",
]) {
  if (!triggerMigration.includes(needle)) throw new Error(`Entitlement active-state contract missing: ${needle}`);
}

console.log(`D1 migration contract passed (${files.length} migrations, baseline ${files[0].slice(0, 4)}).`);
