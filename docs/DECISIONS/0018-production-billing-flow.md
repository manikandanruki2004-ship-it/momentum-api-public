# Decision 0018 — Production Billing Flow

## Context

Razorpay subscription creation is a remote mutation. The application must not grant Pro merely because a browser received a redirect, and a local persistence failure must not hide a successfully created hosted checkout URL.

## Decision

The browser starts checkout through the Momentum billing endpoint. Billing acquires a per-customer D1 checkout lease, creates the Razorpay subscription through `BillingProvider`, persists the checkout attempt when possible, and returns the hosted `short_url`.

Verified Razorpay webhooks remain authoritative for entitlement changes. Webhook processing is deduplicated by provider event ID and reconciles subscriptions by the Momentum customer note and verified payer email fallback.

## Consequences

- Repeated concurrent clicks do not intentionally create multiple active checkout attempts for one customer.
- Provider URL handling stays out of presentation logic except for consuming the validated hosted URL returned by the API.
- A temporary D1 persistence failure does not strand the customer after Razorpay has created the subscription.
- Browser redirects cannot themselves grant Pro access.
