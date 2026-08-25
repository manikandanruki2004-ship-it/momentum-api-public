# Momentum API

Public developer-facing repository for Momentum API.

Momentum ranks GitHub repositories using developer-activity, recency, community, and popularity signals. The commercial engine remains private in `momentum-engine`.

## Public/private boundary

This repository contains only the API contract, SDKs, documentation, and examples. It must never contain production secrets, customer records, GitHub tokens, database credentials, or proprietary scoring implementation.

## API

Production base URL: `https://api.yourdomain.com`

First endpoint:

```http
GET /v1/momentum
X-API-Key: mk_live_...
```

Example:

```bash
curl "https://api.yourdomain.com/v1/momentum?language=python&min_stars=100&limit=10" \
  -H "X-API-Key: mk_live_..."
```

## Python

The lightweight client in `sdk/python` can be copied into a project or packaged later:

```python
from sdk.python import MomentumClient

client = MomentumClient(api_key="mk_live_...")
result = client.momentum(language="python", min_stars=100, limit=10)
print(result["data"])
```

## Contract

- `language`: optional language filter
- `min_stars`: minimum stars
- `max_age_days`: maximum repository age
- `limit`: number of results, from 1 to 50

Responses include repository name, stars, forks, recent activity, momentum score, momentum level, and request metadata.

## Status

The public contract is ready. Deployment-specific hostnames and pricing are placeholders until the production domain and billing configuration are connected.

## Security

Report vulnerabilities privately using `SECURITY.md`. Never open a public issue containing credentials, API keys, or security-sensitive details.
