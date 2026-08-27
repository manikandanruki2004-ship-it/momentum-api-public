# Momentum API Quickstart

Momentum ranks GitHub repositories by developer activity, recency, community signals, popularity, and historical star growth.

## 1. Get an API key

The current launch model provisions keys manually. Never put the admin secret in a browser, frontend, SDK, or public repository.

An issued key looks like:

```text
mk_live_...
```

Store it as an environment variable.

### PowerShell

```powershell
$env:MOMENTUM_API_KEY = "mk_live_..."
```

## 2. Call the API

```powershell
$headers = @{ "X-API-Key" = $env:MOMENTUM_API_KEY }

Invoke-RestMethod `
  -Uri "https://momentum-api-public.manikandanruki2004.workers.dev/v1/momentum?language=python&min_stars=100&limit=5" `
  -Headers $headers
```

## 3. cURL

```bash
curl "https://momentum-api-public.manikandanruki2004.workers.dev/v1/momentum?language=python&min_stars=100&limit=5" \
  -H "X-API-Key: mk_live_..."
```

## 4. Python SDK

```bash
pip install httpx
```

The repository SDK can then be used directly:

```python
from sdk.python import MomentumClient

client = MomentumClient(api_key="mk_live_...")
result = client.momentum(language="python", min_stars=100, limit=5)

for repo in result["data"]:
    print(repo["repository"], repo["momentum_score"])
```

The SDK validates `min_stars`, `max_age_days`, and the production `limit` cap before sending a request.

## 5. JavaScript / TypeScript SDK

```javascript
import { MomentumClient } from "./sdk/javascript/index.js";

const client = new MomentumClient({ apiKey: process.env.MOMENTUM_API_KEY });
const result = await client.momentum({ language: "python", minStars: 100, limit: 5 });
console.log(result.data);
```

## Parameters

| Parameter | Default | Production range |
|---|---:|---:|
| `language` | none | GitHub language name |
| `min_stars` | 100 | 0–1,000,000 |
| `max_age_days` | 3650 | 1–36,500 |
| `limit` | 5 | 1–8 |

## Response

Each result can contain:

- repository
- stars
- forks
- commits_28d
- commits_28d_capped
- stars_7d / stars_28d when history is available
- star velocity and growth-rate fields when history is available
- momentum_score
- momentum_level
- momentum_data_status

The `meta` object exposes the request ID, tier, result cap, commit cap, activity source, and query-cache state.

## Errors

`401` means the API key is missing or invalid.

`429` means either the per-minute rate limit or monthly quota was exceeded.

`502` indicates a GitHub upstream failure.

## Security

Treat API keys as secrets. Do not commit them to Git, put them in client-side JavaScript, or paste them into screenshots or public issues.
