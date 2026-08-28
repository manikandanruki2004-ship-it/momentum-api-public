CREATE TABLE IF NOT EXISTS razorpay_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  razorpay_customer_id TEXT,
  plan_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  current_start INTEGER,
  current_end INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_razorpay_subscriptions_customer
  ON razorpay_subscriptions(customer_id);

CREATE INDEX IF NOT EXISTS idx_razorpay_subscriptions_razorpay_customer
  ON razorpay_subscriptions(razorpay_customer_id);

CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  payload_sha256 TEXT NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_events_received
  ON razorpay_webhook_events(received_at);
