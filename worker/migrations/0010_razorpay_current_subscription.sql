ALTER TABLE razorpay_subscriptions ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_subscriptions_one_current_customer
  ON razorpay_subscriptions(customer_id)
  WHERE is_current = 1;
