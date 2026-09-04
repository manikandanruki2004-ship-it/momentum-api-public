ALTER TABLE razorpay_unclaimed_subscriptions ADD COLUMN payer_email TEXT;
CREATE INDEX IF NOT EXISTS idx_razorpay_unclaimed_payer_email ON razorpay_unclaimed_subscriptions(payer_email);
