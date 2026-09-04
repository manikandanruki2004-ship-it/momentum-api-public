ALTER TABLE customers ADD COLUMN email TEXT;
ALTER TABLE customers ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_google_sub
  ON customers(google_sub)
  WHERE google_sub IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email
  ON customers(email)
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_customer
  ON auth_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
  ON auth_sessions(expires_at);
