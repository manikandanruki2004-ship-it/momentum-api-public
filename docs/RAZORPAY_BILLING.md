# Razorpay Billing Integration Plan

This document defines the production-safe billing flow for Momentum API. It is intentionally configuration-only until Razorpay account and live/test plan IDs are available.

## Launch plans

| Momentum plan | Monthly requests | Rate limit | Max results |
|---|---:|---:|---:|
| Free | 100 | 10/min | 5 |
| Starter | 5,000 | 30/min | 10 |
| Pro | 50,000 | 120/min | 20 |

The technical limits are enforced by the private engine's D1 plan configuration. Payment state must never be trusted from browser input.

## Recommended flow

1. Customer selects Starter or Pro on the public site.
2. Backend creates or starts the corresponding Razorpay subscription/checkout flow.
3. Customer completes payment on Razorpay-hosted checkout.
4. Razorpay sends a signed webhook to the billing endpoint.
5. Backend verifies `X-Razorpay-Signature` against the exact raw webhook body.
6. Backend maps the verified Razorpay plan/subscription to `starter` or `pro`.
7. Backend updates the Momentum customer tier using the centralized plan configuration.
8. API enforcement automatically uses the new monthly quota, rate limit, and result cap.

Razorpay supports subscription APIs and subscription links for recurring billing. Payment Links are also available when a hosted payment-link flow is preferred.

## Security requirements

- Keep Razorpay Key Secret and webhook secret only in server-side secrets.
- Never put Razorpay Key Secret, webhook secret, `ADMIN_SECRET`, `API_KEY_PEPPER`, or the GitHub token in GitHub Pages JavaScript.
- Verify `X-Razorpay-Signature` using HMAC-SHA256.
- Verify the signature over the **raw webhook request body before parsing JSON**.
- Store Razorpay identifiers (customer/subscription/plan IDs) only after validation.
- Make webhook processing idempotent so retries cannot apply the same tier change twice.
- Treat cancelled, halted, expired, and failed subscription states as billing events that can change API access.

## Environment variables to add later

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
RAZORPAY_STARTER_PLAN_ID
RAZORPAY_PRO_PLAN_ID
```

Do not commit actual values to this repository.

## Tier mapping

```text
Razorpay Starter Plan ID -> Momentum `starter`
Razorpay Pro Plan ID     -> Momentum `pro`
```

The mapping must be server-side and allow-listed. Do not accept a tier name from the browser and then grant that tier directly.

## Current implementation boundary

Customer provisioning currently remains protected by `x-admin-secret`. Razorpay integration should not reuse the admin secret in the browser. The eventual billing webhook should be the trusted server-side event that changes a customer's paid status/tier.

## Test mode first

Implement and verify the complete flow with Razorpay Test Mode before enabling live billing. Keep test and live identifiers separate.

## Sources

Razorpay documentation:
- Subscriptions API: https://razorpay.com/docs/api/payments/subscriptions/
- Subscription webhooks: https://razorpay.com/docs/webhooks/subscriptions/
- Webhook validation: https://razorpay.com/docs/webhooks/validate-test/
- Payment Links: https://razorpay.com/docs/payments/payment-links/
