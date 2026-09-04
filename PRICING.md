# Momentum API — Launch Pricing

These are the public launch-plan defaults. Pricing and limits can be adjusted later while validating demand and operating cost.

| Tier | Requests / month | Rate limit | Results / request | Intended use |
|---|---:|---:|---:|---|
| Free | 100 | 10/min | 10 | Evaluation and small scripts |
| Pro | 10,000 | 60/min | 25 | Production apps and automation |

## Account experience

Users sign in with Google. A new Google account automatically receives the Free plan. Normal web users do not need to copy or manage an API key.

Developer API keys remain available as an advanced integration mechanism for applications that call Momentum directly.

## Pro billing

Momentum has one public paid plan: Pro at ₹99/month. The public website uses one reusable Razorpay Subscription Link. Each payer receives a separate Razorpay subscription; the link itself is not tied to one customer.

Momentum activates Pro only after a verified Razorpay subscription event for the allow-listed Pro plan. The billing service can associate a subscription with a Google account using the payer email received from Razorpay. A signed webhook remains the source of truth for billing state.

## Plan enforcement

The private engine stores plan limits in its centralized D1 `plans` table. Result limits are enforced server-side by customer tier.

- **Free:** maximum 10 repositories per request.
- **Pro:** maximum 25 repositories per request.

The public API accepts the global parameter range supported by the server, but the customer's plan cap is the effective maximum. The response `meta.result_limit_cap` reports the active plan's cap.

Quota and rate-limit values are enforced centrally rather than trusting caller-supplied values.

## Pricing principle

Price around the value of reliable repository momentum data while preserving margin for upstream API usage, Cloudflare usage, support, and failed requests.

## Important

The production engine caps commit activity at 500 commits per repository. Do not advertise higher commit limits until implemented and load-tested.
