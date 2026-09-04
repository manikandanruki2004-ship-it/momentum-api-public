# Momentum Public Razorpay Billing

Momentum uses one public paid plan and one reusable Razorpay Subscription Link. The link is not tied to the owner or to a single Momentum customer. Every person who completes checkout gets their own Razorpay subscription.

## Launch plan

| Momentum plan | Price | Monthly requests | Rate limit | Max results |
|---|---:|---:|---:|---:|
| Free | ₹0 | 100 | 10/min | 3 |
| Pro | ₹99/month | 10,000 | 60/min | 25 |

The engine remains the source of truth for API limits. Billing state is changed only from verified Razorpay webhooks and the authenticated claim endpoint.

## Public customer flow

1. User creates or receives a Momentum API key.
2. User opens the single public Pro Subscription Link.
3. Razorpay creates a separate subscription for that payer.
4. Momentum receives the signed subscription webhook and stores the subscription as unclaimed.
5. User claims the subscription with their Momentum API key and the Razorpay subscription ID at `POST /billing/claim`.
6. Momentum marks that subscription as the user's current subscription and upgrades the account to Pro.
7. Later `activated`, `resumed`, `charged`, `paused`, `pending`, `halted`, `cancelled`, `completed`, or `expired` webhook events automatically update access.

This design means the public link can be published on a website, documentation page, README, or social post without embedding a customer ID.

## Environment configuration

Production billing uses only:

```text
RAZORPAY_WEBHOOK_SECRET
RAZORPAY_PRO_PLAN_ID
API_KEY_PEPPER
```

The Razorpay API key and API secret are only needed locally when creating/testing plans or subscription links in Razorpay Test Mode. They are not required by the production Worker when the public Subscription Link is created in the Razorpay Dashboard.

## Security

- Verify the Razorpay signature against the exact raw request body using HMAC-SHA256.
- Treat `x-razorpay-event-id` as the idempotency key and reject payload changes for a reused event ID.
- Keep Razorpay webhook secret and Momentum API-key pepper server-side only.
- Never accept `tier=pro` from a browser and grant Pro directly.
- Only the allow-listed `RAZORPAY_PRO_PLAN_ID` can grant Pro.
- A claim request requires a valid Momentum API key and a previously received, unclaimed Razorpay subscription.
- Terminal subscription events remove the current Pro entitlement.

## Test first

Use Razorpay Test Mode to create exactly one test Pro plan and one reusable test Subscription Link. Use the same link for multiple test customers. The test helper in `tools/razorpay-test.mjs` prints the plan ID and reusable link.

Do not point Test Mode webhooks at a production secret. Configure the webhook secret in the environment that receives Test Mode events, and use separate test identifiers from Live Mode.

## Production setup

Create one Live Razorpay plan for Momentum Pro at ₹99/month and one Live Subscription Link backed by that plan. Configure the Momentum webhook URL:

```text
https://momentum-api-public.manikandanruki2004.workers.dev/webhooks/razorpay
```

Set the Live plan ID as `RAZORPAY_PRO_PLAN_ID` and the Live webhook secret as `RAZORPAY_WEBHOOK_SECRET`. Do not deploy the Live Razorpay API key or API secret to the Worker for this Dashboard-created-link architecture.

## Claim endpoint

```http
POST /billing/claim
X-API-Key: mk_live_...
Content-Type: application/json

{"subscription_id":"sub_..."}
```

A successful response upgrades the authenticated Momentum customer to Pro.

## Sources

Razorpay documentation:
- Subscriptions API: https://razorpay.com/docs/api/payments/subscriptions/
- Create Subscription Link: https://razorpay.com/docs/api/payments/subscriptions/create-subscription-link/
- Subscription Links: https://razorpay.com/docs/payments/subscriptions/create-subscription-links/
- Subscription webhooks: https://razorpay.com/docs/webhooks/subscriptions/
- Webhook validation: https://razorpay.com/docs/webhooks/validate-test/
