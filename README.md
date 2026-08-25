# Momentum API

Public developer-facing repository for the Momentum API.

Momentum ranks GitHub repositories using growth and developer-activity signals. The commercial engine remains private in `momentum-engine`.

## Public/private boundary

This repository contains the API contract, documentation, examples, and client SDK material. It must never contain production secrets, customer records, GitHub tokens, or proprietary scoring implementation.

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

## Contract

- `language`: optional language filter
- `min_stars`: minimum stars
- `max_age_days`: maximum repository age
- `limit`: number of results

The response contains the repository name, stars, forks, recent activity, momentum score, and momentum level.
