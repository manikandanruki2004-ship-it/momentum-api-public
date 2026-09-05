# Momentum API

Momentum ranks GitHub repositories by momentum signals such as recent developer activity, repository recency, community size, popularity, and — once enough history exists — recent star growth.

## Product flow

```text
Google sign-in
    -> bounded live scan
    -> Razorpay Pro checkout
    -> authorization
    -> verified webhook
    -> Pro entitlement
    -> account reflects Pro
```

The public experience is deliberately thin: the browser renders the interface and calls the public gateway; domain state stays behind dedicated Workers.

## Production API

Base URL:

```text
https://momentum-api-public.manikandanruki2004.workers.dev
```

## Customer accounts

The public customer experience uses **Sign in with Google**. A new Google account receives the Free plan.

| Tier | Requests / month | Rate limit | Max results / request |
|---|---:|---:|---:|
| Free | 100 | 10/min | **10** |
| Pro | 10,000 | 60/min | **25** |

Normal web users do not need to create or paste an API key. Google identity is verified server-side and the application issues a browser session.

## Pro billing

**Pro — ₹99/month**.

Each upgrade creates a customer-specific Razorpay subscription. Momentum returns the provider checkout URL promptly and uses verified Razorpay webhook events as the authority for entitlement changes. After returning from checkout, an authenticated account can request `/billing/status` to reconcile the provider's current subscription state; this does not replace webhook authority.

See [`docs/RAZORPAY_BILLING.md`](docs/RAZORPAY_BILLING.md) for the billing lifecycle.

## Architecture

```text
Browser / SDK
      |
      v
+---------------------------+
| momentum-api-public       |
| public Cloudflare gateway |
+---------------------------+
    |         |         |
    v         v         v
  engine    billing    auth
    |         |         |
 GitHub     Razorpay   Google
    |         |         |
    +---------+---------+
              |
             D1 / KV
```

The public gateway owns routing, request IDs, CORS policy, safe error translation, and service-binding health. It does not own ranking, billing state, or authentication business logic.

The private engine remains the source of truth for quotas, rate limits, result caps, repository ranking, GitHub access, caching, and background refresh work.

## Engineering model

Momentum follows a plan-first, modular, secure, observable shipping model based on the supplied **Vibe Engineering Blocks** reference:

- plan the approach, data, and edge cases before coding;
- keep the first useful slice small;
- keep UI, logic, data, and provider integrations separated;
- version migrations and protect multi-step writes;
- validate input at boundaries and keep secrets out of source and logs;
- use HTTPS, explicit authorization, rate limiting, timeouts, safe retries, and calm error handling;
- cache repeated work and move slow work to background jobs;
- use structured logs, request IDs, error tracking, tests, CI/CD, and browser verification;
- keep external providers behind adapters so they can be replaced later;
- maintain durable AI rules in `CLAUDE.md` and reusable procedures in `skills/`.

Project documents:

- [`CLAUDE.md`](CLAUDE.md) — durable AI/build rules
- [`docs/PLAN-V2.md`](docs/PLAN-V2.md) — plan-first delivery plan
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture and invariants
- [`docs/ENGINEERING-CHECKLIST.md`](docs/ENGINEERING-CHECKLIST.md) — implementation gates and remaining work
- [`skills/secure-saas-build/SKILL.md`](skills/secure-saas-build/SKILL.md) — reusable secure SaaS build procedure

## Interactive demo

```text
https://therandomhuman-hub.github.io/momentum-api-public/
```

The demo provides an immediate sample preview, then uses Google sign-in for live queries. It contains no production API key.

## API authentication

Developer integrations can use API keys with `X-API-Key` or `Authorization: Bearer`.

```bash
curl "https://momentum-api-public.manikandanruki2004.workers.dev/v1/momentum?language=python&min_stars=100&limit=20" \
  -H "X-API-Key: mk_live_..."
```

API credentials must never be committed to Git or exposed in browser source.

## Core endpoints

```http
POST /auth/google
GET  /auth/config
GET  /auth/me
POST /auth/logout
GET  /v1/me
GET  /v1/momentum
POST /billing/checkout
GET  /billing/status
POST /billing/claim
POST /webhooks/razorpay
GET  /billing/health
GET  /auth/health
```

`GET /billing/status` requires an authenticated browser session and reads the provider subscription through the billing adapter. It is a reconciliation aid for the customer experience; entitlement authority remains the verified Razorpay webhook path.

## Momentum query parameters

| Parameter | Type | Default | Range |
|---|---|---:|---:|
| `language` | string | empty | max 64 chars |
| `min_stars` | integer | `100` | `0..1000000` |
| `max_age_days` | integer | `3650` | `1..36500` |
| `limit` | integer | `5` | `1..20` |

The server applies the effective limit of the authenticated plan.

## Reliability and verification

Production deployment is expected to follow:

```text
git push
  -> validate
  -> typecheck / tests
  -> deploy services
  -> exercise real service bindings
  -> verify live critical flows
```

A green compile is not sufficient for a browser-facing change. The critical upgrade flow must be tested in a real browser, including navigation to the hosted Razorpay checkout, return to Momentum, billing-status reconciliation, and post-webhook account state.

## Security

Google ID tokens are verified server-side. Google `sub` is the durable identity key. Developer API keys are stored as HMAC-derived hashes. Razorpay webhooks are signature-verified from the raw request body and deduplicated using the provider event ID. Only the configured Pro plan may grant paid entitlement. Secrets remain in Cloudflare/GitHub Actions secret storage and are not committed to this repository.

Report vulnerabilities privately using `SECURITY.md` and never publish credentials or sensitive security details in an issue.
