# Momentum API — Draft Pricing

These are product-design defaults, not final published prices. Validate demand and operating cost before charging customers.

| Tier | Requests / month | Rate limit | Results / request | Intended use |
|---|---:|---:|---:|---|
| Free | 100 | 10/min | 3 | Evaluation and small scripts |
| Starter | 5,000 | 30/min | 5 | Personal tools and prototypes |
| Pro | 50,000 | 120/min | 8 | Production apps |

## Plan enforcement

The private engine stores these limits in its centralized D1 `plans` table. The result cap is enforced per customer tier, so `limit=8` does not let a Free customer receive 8 results.

- **Free:** maximum 3 repositories per request.
- **Starter:** maximum 5 repositories per request.
- **Pro:** maximum 8 repositories per request.

The public API accepts `limit=1..8`, but the customer's plan cap is the effective maximum. The response `meta.result_limit_cap` reports the active plan's cap.

Unknown or inactive tiers are rejected during customer provisioning. Plan quota and rate-limit values are also enforced centrally rather than trusting caller-supplied values.

## Pricing principle

Do not price from GitHub request cost alone. Price around the value of reliable repository momentum data, while keeping enough margin for upstream API usage, Cloudflare usage, support, and failed requests.

## Launch policy

Start with the Free tier and one paid tier. Add the Pro tier after validating demand for higher result counts and throughput.

## Important

The production engine caps commit activity at 500 commits per repository. Do not advertise higher activity limits until they are implemented and load-tested.
