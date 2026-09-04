# Momentum Public Razorpay Billing

Momentum uses one public paid plan and one reusable Razorpay Subscription Link. The link is not tied to the owner or to a single Momentum customer. Every person who completes checkout gets their own Razorpay subscription.

## Launch plans

| Momentum plan | Price | Monthly requests | Rate limit | Max results |
|---|---:|---:|---:|---:|
| Free | ₹0 | 100 | 10/min | 10 |
| Pro | ₹99/month | 10,000 | 60/min | 25 |

The engine remains the source of truth for API limits. Billing state is changed only from verified Razorpay webhooks.

## Sign-in

Momentum uses Google Sign-In for the customer-facing account experience. Google ID tokens are verified server-side before an account is created or loaded. A new Google account receives the Free plan automatically.

The browser receives a 30-day Momentum session token. The session token is stored hashed in D1 and is used only as the browser credential. Developer API keys remain available for direct API integrations.

## Public customer flow

1. User clicks **Sign in with Google**.
2. Momentum verifies the Google ID token and creates or loads the customer's Free account.
3. User opens the single public Pro Subscription Link.
4. Razorpay creates a separate subscription for that payer.
5. Momentum receives the signed subscription webhook.
6. On a verified subscription/payment event, Momentum records the Razorpay payer email and automatically matches it to the unique Google-account email in Momentum.
7. The subscription is attached to that customer and Pro is activated. No API key and no manual subscription ID are required for normal users.
8. Later `activated`, `resumed`, `charged`, `paused`, `pending`, `halted`, `cancelled`, `completed`, or `expired` webhook events update the customer's entitlement.

The public link can therefore be published on a website, documentation page, README, or social post without embedding a customer ID.

## Public endpoints

```http
POST /auth/google
GET  /auth/config
GET  /auth/me
POST /auth/logout

POST /webhooks/razorpay
POST /billing/claim
```

`/billing/claim` is a recovery endpoint. The normal website flow does not ask users to enter a subscription ID.

## Environment configuration

Production uses:

```text
GOOGLE_CLIENT_ID
RAZORPAY_WEBHOOK_SECRET
RAZORPAY_PRO_PLAN_ID
API_KEY_PEPPER
```

The Razorpay API key and API secret are only needed locally when creating/testing plans or Subscription Links in Razorpay Test Mode. They are not required by the production Worker for the Dashboard-created public Subscription Link architecture.

## Security

- Verify the Google ID-token signature, issuer, audience, expiration, and verified email server-side.
- Use Google's stable `sub` identifier for account identity.
- Verify the Razorpay signature against the exact raw request body using HMAC-SHA256.
- Treat `x-razorpay-event-id` as the webhook idempotency key and reject a reused event ID with a different payload.
- Never grant Pro from browser-supplied plan/tier data.
- Only the allow-listed `RAZORPAY_PRO_PLAN_ID` can grant Pro.
- Automatic subscription linking happens only after a verified Razorpay event and an exact normalized email match.
- Terminal subscription events remove the current Pro entitlement.
- Keep Google configuration, Razorpay webhook secret, and API-key pepper server-side.

## Test first

Use Razorpay Test Mode to create exactly one test Pro plan and one reusable test Subscription Link. Use the same link for multiple test customers. Keep Test Mode webhook secrets and plan IDs separate from Live Mode values. Do not point Test Mode webhooks at a production secret.

## Production setup

Create one Live Razorpay plan for Momentum Pro at ₹99/month and one Live Subscription Link backed by that plan. Configure the Momentum webhook URL:

```text
https://momentum-api-public.manikandanruki2004.workers.dev/webhooks/razorpay
```

Set the Live plan ID as `RAZORPAY_PRO_PLAN_ID` and the Live webhook secret as `RAZORPAY_WEBHOOK_SECRET`. Do not deploy the Live Razorpay API key or API secret to the Worker for this Dashboard-created-link architecture.
