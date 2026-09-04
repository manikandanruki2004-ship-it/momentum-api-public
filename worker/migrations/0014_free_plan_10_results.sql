UPDATE plans SET max_results=10 WHERE tier='free';
UPDATE customers
SET monthly_quota=(SELECT monthly_quota FROM plans WHERE tier='free'),
    rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier='free')
WHERE tier='free';
