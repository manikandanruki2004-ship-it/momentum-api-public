CREATE TABLE IF NOT EXISTS razorpay_unclaimed_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  razorpay_customer_id TEXT,
  plan_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  current_start INTEGER,
  current_end INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_created_at INTEGER,
  is_claimed INTEGER NOT NULL DEFAULT 0,
  claimed_customer_id TEXT,
  claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_razorpay_unclaimed_plan
  ON razorpay_unclaimed_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_unclaimed_claimed
  ON razorpay_unclaimed_subscriptions(is_claimed, updated_at DESC);