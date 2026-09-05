-- Keep the local Razorpay customer id synchronized when webhook data arrives.
-- The initial subscription-creation response normally has no customer_id; Razorpay
-- populates it after the authorisation transaction. The webhook stores that value in
-- razorpay_unclaimed_subscriptions, while an existing subscription row may already
-- exist. These triggers keep both records synchronized.

CREATE TRIGGER IF NOT EXISTS trg_sync_razorpay_customer_id_insert
AFTER INSERT ON razorpay_unclaimed_subscriptions
WHEN NEW.razorpay_customer_id IS NOT NULL
BEGIN
  UPDATE razorpay_subscriptions
  SET razorpay_customer_id = NEW.razorpay_customer_id,
      updated_at = datetime('now')
  WHERE subscription_id = NEW.subscription_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sync_razorpay_customer_id_update
AFTER UPDATE OF razorpay_customer_id ON razorpay_unclaimed_subscriptions
WHEN NEW.razorpay_customer_id IS NOT NULL
BEGIN
  UPDATE razorpay_subscriptions
  SET razorpay_customer_id = NEW.razorpay_customer_id,
      updated_at = datetime('now')
  WHERE subscription_id = NEW.subscription_id;
END;

-- Backfill any customer ids that already reached the unclaimed table.
UPDATE razorpay_subscriptions
SET razorpay_customer_id = (
  SELECT u.razorpay_customer_id
  FROM razorpay_unclaimed_subscriptions u
  WHERE u.subscription_id = razorpay_subscriptions.subscription_id
    AND u.razorpay_customer_id IS NOT NULL
  LIMIT 1
),
updated_at = datetime('now')
WHERE razorpay_customer_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM razorpay_unclaimed_subscriptions u
    WHERE u.subscription_id = razorpay_subscriptions.subscription_id
      AND u.razorpay_customer_id IS NOT NULL
  );
