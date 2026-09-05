import fs from 'node:fs';

const dir = 'worker/migrations';
const files = fs.readdirSync(dir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (!files.length) throw new Error('No numbered D1 migrations found.');

for (let i = 0; i < files.length; i++) {
  const expected = String(i + 1).padStart(4, '0');
  if (!files[i].startsWith(`${expected}_`)) {
    throw new Error(`D1 migration sequence gap: expected ${expected}, found ${files[i].slice(0, 4)}.`);
  }
}

const required = [
  ['0010_razorpay_current_subscription.sql', 'current-subscription invariant migration'],
  ['0016_razorpay_checkout_attempts.sql', 'checkout lease migration'],
  ['0017_auth_rate_limit.sql', 'auth rate-limit migration'],
  ['0018_billing_entitlement_sync_triggers.sql', 'billing entitlement trigger migration'],
  ['0019_rebuild_billing_entitlement_sync_triggers.sql', 'billing entitlement trigger rebuild migration'],
];

for (const [name, description] of required) {
  if (!files.includes(name)) throw new Error(`Missing ${description}: ${name}`);
}

const triggerMigration = fs.readFileSync(`${dir}/0019_rebuild_billing_entitlement_sync_triggers.sql`, 'utf8');
for (const needle of [
  'DROP TRIGGER IF EXISTS trg_sync_customer_entitlement_insert',
  'CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_insert',
  'CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_update',
  'CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_delete',
  "status IN ('active','pending','halted','paused')",
]) {
  if (!triggerMigration.includes(needle)) throw new Error(`Entitlement trigger contract missing: ${needle}`);
}

console.log(`D1 migration contract passed (${files.length} ordered migrations).`);
