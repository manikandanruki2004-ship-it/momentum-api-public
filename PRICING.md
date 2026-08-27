# Momentum API — Draft Pricing

These are product-design defaults, not final published prices. Validate demand and operating cost before charging customers.

| Tier | Requests / month | Rate limit | Results / request | Intended use |
|---|---:|---:|---:|---|
| Free | 100 | 10/min | 8 | Evaluation and small scripts |
| Starter | 5,000 | 30/min | 8 | Personal tools and prototypes |
| Pro | 50,000 | 120/min | 8 | Production apps |
| Business | 500,000 | 300/min | 8 | Higher-volume commercial integrations |

## Enforcement

The private engine stores these plan limits in its centralized D1 `plans` table. Customer provisioning and tier changes are rejected when the supplied quota or rate limit does not match the configured plan.

This separates commercial pricing from technical enforcement: payment logic can change without rewriting the request-limit implementation.

## Pricing principle

Do not price from GitHub request cost alone. Price around the value of reliable repository momentum data, while keeping enough margin for upstream API usage, Cloudflare usage, support, and failed requests.

## Launch policy

Start with the Free tier and one paid tier. Add more tiers only after usage data shows a meaningful difference in customer needs.

## Important

The production engine caps results at 8 repositories per request and commit activity at 500 commits per repository. Do not advertise higher limits until they are implemented and load-tested.
