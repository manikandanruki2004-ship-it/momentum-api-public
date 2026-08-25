# Momentum API

Public developer-facing gateway for Momentum API.

Momentum ranks GitHub repositories using developer-activity, recency, community, and popularity signals. The proprietary engine lives in the private `momentum-engine` repository.

## Architecture

```text
Customer
   |
   v
momentum-api-public   (PUBLIC gateway)
   |
   | private Render network + shared service secret
   v
momentum-engine       (PRIVATE engine)
   |
   +--> GitHub API
   +--> PostgreSQL
   +--> Render Key Value
```

The public repository contains only the gateway, API contract, SDKs, docs, and examples. It must never contain production secrets, customer records, GitHub tokens, database credentials, or proprietary scoring implementation.

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

## Deployment

Deploy `momentum-engine` first so the private Render service `momentum-engine-staging` exists. Then deploy this repository as `momentum-gateway-staging`; its Blueprint reads the engine's generated `WRAPPER_SHARED_SECRET` through Render's private-service wiring.

The public gateway never receives the GitHub token or database credentials. Customer API keys are validated by the private engine.

## Status

The source and staging deployment definitions are prepared. Production remains blocked until a real domain, production datastore plans, GitHub credential, and billing configuration are supplied.

## Security

Report vulnerabilities privately using `SECURITY.md`. Never open a public issue containing credentials, API keys, or security-sensitive details.
