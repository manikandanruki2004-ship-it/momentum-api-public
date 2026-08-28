# Momentum API

Momentum is a developer-facing API that ranks GitHub repositories by momentum signals: recent developer activity, repository recency, community size, popularity, and — once enough history exists — recent star growth.

The API is deliberately split into two repositories:

- **`momentum-api-public`** — public gateway, API contract, SDKs, docs, demo, and examples.
- **`momentum-engine`** — private scoring, customer records, quotas, rate limiting, GitHub credentials, and D1 data.

The public repository must never contain production secrets, customer records, GitHub tokens, database credentials, or proprietary scoring implementation.

## Production API

Base URL:

```text
https://momentum-api-public.manikandanruki2004.workers.dev
```

## Authentication

Send the API key with either `X-API-Key` or `Authorization: Bearer`.

```bash
curl "https://momentum-api-public.manikandanruki2004.workers.dev/v1/momentum?language=python&min_stars=100&limit=20" \\
  -H "X-API-Key: mk_live_..."
```

Never commit an API key to Git. Treat a `mk_live_...` value as a secret.

## Endpoint

```http
GET /v1/momentum
```

Query parameters:

| Parameter | Type | Default | Range | Description |
|---|---|---:|---:|---|
| `language` | string | empty | — | Optional GitHub language filter |
| `min_stars` | integer | `100` | `0..1000000` | Minimum repository star count |
| `max_age_days` | integer | `3650` | `1..36500` | Maximum repository age filter used in GitHub search |
| `limit` | integer | `5` | `1..20` | Requested number of repositories; plan limits may apply |

The effective result cap is determined by the authenticated plan.

## Plans

| Tier | Requests / month | Rate limit | Max results / request |
|---|---:|---:|---:|
| Free | 100 | 10/min | **5** |
| Starter | 5,000 | 30/min | **10** |
| Pro | 50,000 | 120/min | **20** |

The private engine enforces these limits from centralized D1 plan configuration. Requesting a larger `limit` never bypasses the customer's plan cap.

## Example response

```json
{
  "data": [
    {
      "repository": "owner/example",
      "stars": 12345,
      "forks": 1200,
      "commits_28d": 84,
      "commits_28d_capped": false,
      "stars_7d": null,
      "stars_28d": null,
      "star_velocity_7d": null,
      "star_velocity_28d": null,
      "star_growth_rate_7d": null,
      "snapshot_7d_at": null,
      "snapshot_28d_at": null,
      "momentum_score": 72.4,
      "momentum_level": "high",
      "momentum_data_status": "warming_up"
    }
  ],
  "meta": {
    "count": 1,
    "tier": "free",
    "request_id": "req_...",
    "activity_window_days": 28,
    "star_velocity_windows_days": [7, 28],
    "commit_count_cap": 500,
    "result_limit_cap": 5,
    "activity_source": "background_cache_with_live_fallback",
    "query_cache": "miss"
  }
}
```

`momentum_data_status` is `warming_up` until enough historical snapshots exist to calculate the star-growth signals. The API does not invent missing history.

## Errors

| Status | Code | Meaning |
|---:|---|---|
| `401` | `UNAUTHORIZED` | API key missing or invalid |
| `429` | `RATE_LIMIT_EXCEEDED` | Per-minute request limit reached |
| `429` | `QUOTA_EXCEEDED` | Monthly quota reached |
| `502` | `GITHUB_UPSTREAM_ERROR` | GitHub could not be queried |
| `503` | `ENGINE_UNAVAILABLE` | Public gateway could not reach the private engine |

Errors include a `request_id` to make troubleshooting and support easier.

## Quickstart

See [`docs/QUICKSTART.md`](docs/QUICKSTART.md) for PowerShell, cURL, Python, JavaScript, parameter ranges, and security guidance.

## SDKs

### Python

```python
from sdk.python import MomentumClient

client = MomentumClient(api_key="mk_live_...")
result = client.momentum(language="python", min_stars=100, limit=20)
print(result["data"])
```

### JavaScript / TypeScript

```javascript
import { MomentumClient } from "./sdk/javascript/index.js";

const client = new MomentumClient({ apiKey: process.env.MOMENTUM_API_KEY });
const result = await client.momentum({ language: "python", minStars: 100, limit: 20 });
console.log(result.data);
```

Both SDKs validate the global API parameter limits before making a request. The server then applies the authenticated customer's plan cap.

## Interactive demo

Try the hosted demo:

https://therandomhuman-hub.github.io/momentum-api-public/

The demo has a sample mode and an optional live mode. Do not embed a production API key in the public site.

## Architecture

```text
Developer
   |
   v
momentum-api-public
PUBLIC Cloudflare Worker gateway
   |
   | Service Binding
   v
momentum-engine
PRIVATE Cloudflare Worker
   |
   +--> GitHub API
   +--> Cloudflare D1
   +--> Cloudflare KV (legacy/support binding)

Background every 6 hours
   |
   +--> GitHub activity
   +--> D1 star snapshots
   +--> D1 activity cache
```

Customer requests enforce authentication, atomic per-customer rate limiting, and monthly quota before evaluating the query cache. The query cache is short-lived (60 seconds) and does not bypass customer controls.

## Billing readiness

See [`docs/RAZORPAY_BILLING.md`](docs/RAZORPAY_BILLING.md) for the planned Razorpay subscription flow and webhook security requirements. Payment credentials and webhook secrets belong only in server-side secrets.

## Data and freshness

The engine stores repository snapshots for historical comparisons and maintains a short-lived activity cache. The API can use the background cache and falls back to live GitHub commit counting when cached activity is unavailable.

A commit count is capped at 500 to bound upstream usage. `commits_28d_capped: true` means the actual count may be at least 500.

## Pricing

See [`PRICING.md`](PRICING.md). Published pricing remains a product-design draft until billing is enabled.

## Security

- GitHub credentials stay in the private Worker.
- Customer API keys are stored as HMAC-derived hashes, not plaintext.
- Rate limiting and monthly quota are enforced atomically in D1.
- The public gateway contains no customer database or scoring implementation.

Report vulnerabilities privately using `SECURITY.md`. Never open a public issue containing credentials, API keys, or security-sensitive details.
