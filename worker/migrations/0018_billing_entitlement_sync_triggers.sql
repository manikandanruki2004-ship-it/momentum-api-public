CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_insert
AFTER INSERT ON razorpay_subscriptions
BEGIN
  UPDATE customers
  SET tier = CASE
      WHEN NEW.is_current = 1 AND NEW.status = 'active' THEN 'pro'
      WHEN NEW.is_current = 1 AND NEW.status IN ('pending','halted','paused') THEN 'pro'
      ELSE 'free'
    END,
    monthly_quota = (
      SELECT monthly_quota FROM plans
      WHERE tier = CASE
        WHEN NEW.is_current = 1 AND NEW.status IN ('active','pending','halted','paused') THEN 'pro'
        ELSE 'free'
      END AND active = 1
    ),
    rate_limit_per_minute = (
      SELECT rate_limit_per_minute FROM plans
      WHERE tier = CASE
        WHEN NEW.is_current = 1 AND NEW.status IN ('active','pending','halted','paused') THEN 'pro'
        ELSE 'free'
      END AND active = 1
    ),
    active = CASE
      WHEN NEW.is_current = 1 AND NEW.status = 'active' THEN 1
      ELSE 1
    END
  WHERE id = NEW.customer_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_update
AFTER UPDATE OF is_current, status, customer_id ON razorpay_subscriptions
BEGIN
  UPDATE customers
  SET tier = CASE
      WHEN EXISTS (
        SELECT 1 FROM razorpay_subscriptions s
        WHERE s.customer_id = customers.id
          AND s.is_current = 1
          AND s.status IN ('active','pending','halted','paused')
      ) THEN 'pro'
      ELSE 'free'
    END,
    monthly_quota = (
      SELECT monthly_quota FROM plans
      WHERE tier = CASE
        WHEN EXISTS (
          SELECT 1 FROM razorpay_subscriptions s
          WHERE s.customer_id = customers.id
            AND s.is_current = 1
            AND s.status IN ('active','pending','halted','paused')
        ) THEN 'pro' ELSE 'free' END
        AND active = 1
    ),
    rate_limit_per_minute = (
      SELECT rate_limit_per_minute FROM plans
      WHERE tier = CASE
        WHEN EXISTS (
          SELECT 1 FROM razorpay_subscriptions s
          WHERE s.customer_id = customers.id
            AND s.is_current = 1
            AND s.status IN ('active','pending','halted','paused')
        ) THEN 'pro' ELSE 'free' END
        AND active = 1
    ),
    active = 1
  WHERE id IN (OLD.customer_id, NEW.customer_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_sync_customer_entitlement_delete
AFTER DELETE ON razorpay_subscriptions
BEGIN
  UPDATE customers
  SET tier = CASE
      WHEN EXISTS (
        SELECT 1 FROM razorpay_subscriptions s
        WHERE s.customer_id = customers.id
          AND s.is_current = 1
          AND s.status IN ('active','pending','halted','paused')
      ) THEN 'pro' ELSE 'free' END,
    monthly_quota = (
      SELECT monthly_quota FROM plans
      WHERE tier = CASE
        WHEN EXISTS (
          SELECT 1 FROM razorpay_subscriptions s
          WHERE s.customer_id = customers.id
            AND s.is_current = 1
            AND s.status IN ('active','pending','halted','paused')
        ) THEN 'pro' ELSE 'free' END
        AND active = 1
    ),
    rate_limit_per_minute = (
      SELECT rate_limit_per_minute FROM plans
      WHERE tier = CASE
        WHEN EXISTS (
          SELECT 1 FROM razorpay_subscriptions s
          WHERE s.customer_id = customers.id
            AND s.is_current = 1
            AND s.status IN ('active','pending','halted','paused')
        ) THEN 'pro' ELSE 'free' END
        AND active = 1
    ),
    active = 1
  WHERE id = OLD.customer_id;
END;
