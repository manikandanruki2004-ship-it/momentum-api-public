# Momentum API — Draft Pricing

These are product-design defaults, not final published prices. Validate demand and operating cost before charging customers.

| Tier | Requests / month | Rate limit | Intended use |
|---|---:|---:|---|
| Free | 100 | 10/min | Evaluation and small scripts |
| Starter | 5,000 | 30/min | Personal tools and prototypes |
| Pro | 50,000 | 120/min | Production apps |
| Business | Custom | Custom | Higher volume and commercial integrations |

## Pricing principle

Do not price from GitHub request cost alone. Price around the value of reliable repository momentum data, while keeping enough margin for upstream API usage, Cloudflare usage, support, and failed requests.

## Launch policy

Start with the Free tier and one paid tier. Add more tiers only after usage data shows a meaningful difference in customer needs.

## Important

The current production engine caps results at 8 repositories per request and commit activity at 500 commits per repository. Do not advertise higher limits until they are implemented and load-tested.
