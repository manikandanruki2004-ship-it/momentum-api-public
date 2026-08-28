# Account & Usage API

The authenticated account endpoint lets a customer inspect the plan and current API usage without exposing the API key itself.

## Endpoint

```http
GET /v1/me
```

Authentication:

```http
X-API-Key: mk_live_...
```

`Authorization: Bearer mk_live_...` is also accepted.

## Example

```bash
curl https://momentum-api-public.manikandanruki2004.workers.dev/v1/me \
  -H "X-API-Key: mk_live_..."
```

Example response:

```json
{
  "customer": {
    "id": "cus_...",
    "name": "My App",
    "tier": "starter",
    "active": true,
    "api_key_prefix": "mk_live_..."
  },
  "plan": {
    "monthly_quota": 5000,
    "monthly_usage": 42,
    "remaining_requests": 4958,
    "rate_limit_per_minute": 30,
    "max_results": 10,
    "usage_month": "2026-08"
  },
  "usage": {
    "requests": 42,
    "successful": 42,
    "failed": 0,
    "average_latency_ms": 1260
  }
}
```

The endpoint returns only a masked API-key prefix. It never returns the full secret key. Full keys are shown only once, at customer provisioning time.

## Billing readiness

When Razorpay billing is added, the payment webhook can change the customer's tier. This endpoint will then immediately expose the effective quota, rate limit, and maximum results for that tier.

Razorpay webhook verification must happen server-side using the raw request body and the `X-Razorpay-Signature` HMAC-SHA256 header.
