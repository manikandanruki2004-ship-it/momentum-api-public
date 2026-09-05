CREATE TABLE IF NOT EXISTS razorpay_checkout_attempts (
  customer_id TEXT PRIMARY KEY,
  subscription_id TEXT UNIQUE,
  checkout_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating','created','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_razorpay_checkout_attempts_expires_at
  ON razorpay_checkout_attempts(expires_at);
