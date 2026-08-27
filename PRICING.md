# Momentum API — Launch Pricing

These are launch-plan defaults. Keep pricing adjustable while validating demand and operating cost.

| Tier | Requests / month | Rate limit | Results / request | Intended use |
|---|---:|---:|---:|---|
| Free | 100 | 10/min | 5 | Evaluation and small scripts |
| Starter | 5,000 | 30/min | 10 | Personal tools and prototypes |
| Pro | 50,000 | 120/min | 20 | Production apps |

## Plan enforcement

The private engine stores plan limits in its centralized D1 `plans` table. Result limits are enforced server-side by customer tier.

- **Free:** maximum 5 repositories per request.
- **Starter:** maximum 10 repositories per request.
- **Pro:** maximum 20 repositories per request.

The public API accepts `limit=1..20`, but the customer's plan cap is the effective maximum. The response `meta.result_limit_cap` reports the active plan's cap.

Unknown or inactive tiers are rejected during customer provisioning. Plan quota and rate-limit values are enforced centrally rather than trusting caller-supplied values.

## Pricing principle

Price around the value of reliable repository momentum data while preserving margin for upstream API usage, Cloudflare usage, support, and failed requests.

## Launch policy

Start with Free + Starter + Pro. Keep the plan definitions centralized so pricing or limits can change without rewriting request handling.

## Important

The production engine caps commit activity at 500 commits per repository. Do not advertise higher commit limits until implemented and load-tested.
