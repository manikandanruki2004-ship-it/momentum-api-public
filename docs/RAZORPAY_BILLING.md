# Momentum Public Razorpay Billing

Momentum uses one public paid plan and one reusable Razorpay Subscription Link. The link is not tied to the owner or to a single Momentum customer. Every person who completes checkout gets their own Razorpay subscription.

## Launch plans

| Momentum plan | Price | Monthly requests | Rate limit | Max results |
|---|---:|---:|---:|---:|
| Free | ₹0 | 100 | 10/min | 10 |
| Pro | ₹99/month | 10,000 | 60/min | 25 |

The engine remains the source of truth for API limits. Billing state is changed only from verified Razorpay webhooks.

## Sign-in

Momentum now uses Google Sign-In for the customer-facing account experience. Google Identity Services returns an ID token to the backend; the backend verifies the token signature, issuer, audience, expiry, verified email, and stable Google `sub` identifier before creating or locating the Momentum account. Google documents `sub` as the unique user identifier and requires server-side token validation. 

Public endpoint:

```text
POST /auth/google
Content-Type: application/json

{"credential":"<Google ID token>"}
```

The endpoint creates a Free account automatically when the Google account is new. Free accounts receive 100 requests/month, 10 requests/minute, and 10 results/request.

The API key remains an internal developer credential for compatibility with the existing API layer; it is not the user-facing sign-in method.

## Public customer flow

1. User clicks **Sign in with Google**.
2. Momentum verifies the Google ID token and creates or loads the customer's Free account.
3. User opens the single public Pro Subscription Link.
4. Razorpay creates a separate subscription for that payer.
5. Momentum receives the signed subscription webhook and stores the subscription as unclaimed.
6. The authenticated billing flow associates that subscription with the signed-in Momentum customer.
7. A verified Pro subscription changes the account to Pro.
8. Later `activated`, `resumed`, `charged`, `paused`, `pending`, `halted`, `cancelled`, `completed`, or `expired` webhook events automatically update access.

This design means the public link can be published on a website, documentation page, README, or social post without embedding a customer ID.

## Environment configuration

Production billing uses:

```text
RAZORPAY_WEBHOOK_SECRET
RAZORPAY_PRO_PLAN_ID
API_KEY_PEPPER
GOOGLE_CLIENT_ID
```

The Razorpay API key and API secret are only needed locally when creating/testing plans or subscription links in Razorpay Test Mode. They are not required by the production Worker when the public Subscription Link is created in the Razorpay Dashboard.

## Google configuration

Create a Google OAuth 2.0 Web application client and store its Client ID as the GitHub Actions secret `GOOGLE_CLIENT_ID`. The frontend must use the same Client ID with Google Identity Services. Google requires the configured authorized origins/redirect URIs to match the application. urlGoogle Sign In with Google JavaScript referencehttps://developers.google.com/identity/gsi/web/reference/js-reference

## Security

- Verify the Google ID-token signature and claims server-side; use the Google `sub` claim as the durable account identifier.
- Require `email_verified=true` before creating or linking an account.
- Verify the Razorpay signature against the exact raw request body using HMAC-SHA256.
- Treat `x-razorpay-event-id` as the idempotency key and reject payload changes for a reused event ID.
- Keep Google Client ID configuration, Razorpay webhook secret, and API-key pepper server-side.
- Never accept `tier=pro` from a browser and grant Pro directly.
- Only the allow-listed `RAZORPAY_PRO_PLAN_ID` can grant Pro.
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
