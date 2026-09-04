ALTER TABLE razorpay_subscriptions ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT subscription_id,
         ROW_NUMBER() OVER (
           PARTITION BY customer_id
           ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                    COALESCE(last_event_created_at, 0) DESC,
                    updated_at DESC
         ) AS rn
  FROM razorpay_subscriptions
)
UPDATE razorpay_subscriptions
SET is_current = 1
WHERE subscription_id IN (SELECT subscription_id FROM ranked WHERE rn = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_subscriptions_one_current_customer
  ON razorpay_subscriptions(customer_id)
  WHERE is_current = 1;
