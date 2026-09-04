ALTER TABLE razorpay_subscriptions ADD COLUMN suspended_at TEXT;
ALTER TABLE razorpay_subscriptions ADD COLUMN ended_at INTEGER;
ALTER TABLE razorpay_subscriptions ADD COLUMN last_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_razorpay_subscriptions_customer_history
  ON razorpay_subscriptions(customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_razorpay_subscriptions_razorpay_customer
  ON razorpay_subscriptions(razorpay_customer_id);
