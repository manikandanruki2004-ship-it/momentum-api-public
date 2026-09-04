# Momentum API

Momentum is an API that ranks GitHub repositories by momentum signals: recent developer activity, repository recency, community size, popularity, and — once enough history exists — recent star growth.

## Production API

Base URL:

```text
https://momentum-api-public.manikandanruki2004.workers.dev
```

## Customer accounts

The public customer experience uses **Sign in with Google**. A new Google account automatically receives the Free plan:

| Tier | Requests / month | Rate limit | Max results / request |
|---|---:|---:|---:|
| Free | 100 | 10/min | **10** |
| Pro | 10,000 | 60/min | **25** |

Normal web users do not need to create or paste an API key. Momentum verifies the Google ID token server-side, creates/loads the account, and issues a browser session.

## Pro billing

Momentum has one public paid plan: **Pro — ₹99/month**.

There is one reusable public Razorpay Subscription Link. Each payer receives their own Razorpay subscription. Momentum activates Pro only after a verified Razorpay webhook for the allow-listed Pro plan.

The billing service records the Razorpay payer email and automatically matches it to the unique verified Google email on the Momentum account. Normal users do not enter a subscription ID or API key to upgrade.

See [`docs/RAZORPAY_BILLING.md`](docs/RAZORPAY_BILLING.md) for the complete lifecycle and security model.

## Developer API authentication

Developer integrations can still use API keys with `X-API-Key` or `Authorization: Bearer`.

```bash
curl "https://momentum-api-public.manikandanruki2004.workers.dev/v1/momentum?language=python&min_stars=100&limit=25" \
  -H "X-API-Key: mk_live_..."
```

API keys are developer credentials. Never commit them to Git or expose them in public frontend source.

## Account endpoints

```http
POST /auth/google
GET  /auth/config
GET  /auth/me
POST /auth/logout
GET  /v1/me
```

`/auth/google` accepts the Google Identity Services `credential`. `/auth/me` returns the signed-in customer's account and current plan.

## Momentum endpoint

```http
GET /v1/momentum
```

Parameters:

| Parameter | Type | Default | Range | Description |
|---|---|---:|---:|---|
| `language` | string | empty | — | Optional GitHub language filter |
| `min_stars` | integer | `100` | `0..1000000` | Minimum repository star count |
| `max_age_days` | integer | `3650` | `1..36500` | Maximum repository age filter |
| `limit` | integer | `5` | `1..20` | Requested result count; plan caps still apply |

The server always applies the authenticated plan's effective result limit.

## Architecture

```text
Browser / Developer
        |
        v
momentum-api-public
PUBLIC Cloudflare Worker gateway
   |          |             |
   |          |             +--> momentum-auth
   |          +----------------> momentum-billing
   +---------------------------> momentum-engine
                                      |
                                      +--> GitHub API
                                      +--> Cloudflare D1
                                      +--> Cloudflare KV

Background every 6 hours
   |
   +--> GitHub activity
   +--> D1 star snapshots
   +--> D1 activity cache
```

The public gateway contains no GitHub credentials, scoring implementation, or customer database logic. The private engine remains the source of truth for quotas, rate limits, and result caps.

## Interactive demo

```text
https://therandomhuman-hub.github.io/momentum-api-public/
```

The demo uses Google sign-in for live queries. Public source code contains no production API key.

## Billing webhook

```text
POST /webhooks/razorpay
```

Razorpay signatures are verified over the exact raw webhook body. Webhook processing is idempotent using `x-razorpay-event-id`. Terminal subscription events remove the paid entitlement.

## Data freshness

The engine stores repository snapshots for historical comparisons and maintains a short-lived activity cache. Live requests fall back to GitHub commit counting when cached activity is unavailable.

Commit activity is bounded at 500 commits per repository to limit upstream usage.

## Security

- Google ID tokens are verified server-side.
- Google `sub` is the durable Google identity key.
- Verified Google email is stored only as the account identity needed for billing association.
- Developer API keys are stored as HMAC-derived hashes.
- Razorpay webhooks are signature-verified before billing state changes.
- Only the configured Razorpay Pro plan ID can grant Pro.
- Secrets remain in Cloudflare/GitHub Actions secrets and are not committed to this repository.

Report vulnerabilities privately using `SECURITY.md`. Never open a public issue containing credentials or security-sensitive details.
