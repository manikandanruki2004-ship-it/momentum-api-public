# Momentum API — Architecture v2

This document turns the 47-block engineering model from the supplied reference into concrete rules for Momentum. The reference emphasizes planning before code, a small useful slice, modularity, separation of UI/logic/data, safe data changes, security, reliability, performance, observability, automated shipping, provider adapters, browser tests, and reusable AI rules.

## 1. Product boundary

Momentum has one clear core job: return ranked GitHub repository momentum data. Everything else supports that path: Google authentication, usage limits, Pro billing, data freshness, and developer access.

The public demo is a UI client. It does not contain secrets or business rules. The public gateway exposes a stable HTTP contract and delegates domain responsibilities to dedicated Workers.

## 2. Runtime topology

```text
Browser / SDK
      |
      v
+---------------------------+
| momentum-api-public       |
| public API gateway        |
+---------------------------+
   |          |          |
   |          |          +-------------------+
   |          v                              |
   |   momentum-auth                         |
   |                                        |
   v                                        v
momentum-engine                      momentum-billing
ranking + quotas                     subscriptions + webhooks
   |                                        |
   +--> GitHub                             +--> Razorpay
   +--> D1                                  |
   +--> KV                                  +--> D1
```

The gateway owns routing, CORS policy, request IDs, safe error translation, and binding-level health checks. It does not own billing state or ranking logic.

## 3. Layers

### Presentation
`demo/` contains the browser application. It talks to the public gateway only. Rendering and interaction code should not directly know database schemas or provider internals.

### Gateway
`worker/` is a thin adapter layer. It validates method/path combinations, adds request context, calls the appropriate service binding, and maps failures to safe responses.

### Domain services
- `auth/`: identity verification, session creation, customer provisioning.
- `billing/`: subscription creation, webhook verification, entitlement transitions.
- private `momentum-engine`: repository ranking, quotas, usage, GitHub access, caching, background refresh.

### Persistence
D1 stores relational business state. Migrations are the only schema-change mechanism. KV is for bounded, cache-like or rate-limit state.

## 4. Critical invariants

1. A Google identity is linked to one Momentum customer.
2. A billing event can be retried without granting duplicate entitlement.
3. Only an allow-listed Pro plan can produce Pro access.
4. A successful Razorpay subscription creation must return the provider checkout URL even if best-effort local persistence has a temporary failure; later webhook processing reconciles state.
5. Terminal billing events remove the paid entitlement.
6. The browser never receives secrets, internal stack traces, or database details.
7. A deployment is not considered healthy until each service binding and each critical public route has passed smoke verification.

## 5. Billing state machine

```text
created
  |
  v
authenticated / pending
  |
  +--> active ------> paused/pending/halted ------> active
  |
  +--> cancelled/completed/expired
```

Momentum entitlement is derived from verified provider events, not from a browser claim. The email/customer matching path exists as a reconciliation aid, not as authority to bypass webhook verification.

## 6. Data model direction

Keep mutable facts in one table and connect related records with identifiers. Billing uses a durable internal customer ID plus Razorpay identifiers. Unclaimed subscription records exist only as a reconciliation buffer until they can be safely attached to a customer.

Frequent access paths require indexes, especially:
- customer email lookup;
- subscription ID lookup;
- Razorpay customer ID lookup;
- current subscription lookup by Momentum customer;
- webhook event ID lookup.

## 7. Reliability policy

Outbound calls use bounded timeouts. Retries are restricted to operations that are safe to repeat and use backoff. Repeated dependency failure should be contained rather than amplified. Shared state updates that can race are made atomic.

For billing specifically:
- create-subscription is treated as a remote mutation;
- local persistence after remote creation is not allowed to erase a valid provider checkout result;
- webhook processing is idempotent by provider event ID;
- entitlement updates are derived from ordered provider events.

## 8. Performance policy

Live ranking should prefer cached activity where correctness permits. Expensive refresh work belongs in background jobs. Public endpoints are rate limited. Large lists are bounded and paginated instead of returning unbounded datasets.

## 9. Observability policy

Every request gets a request ID. Logs should be structured and carry safe context. Provider errors, binding failures, and webhook processing failures should be searchable by request ID or provider event ID. User-facing responses stay concise and safe.

## 10. Delivery policy

```text
git push
   -> validate
   -> typecheck
   -> unit/integration checks
   -> browser smoke checks
   -> deploy
   -> service health checks
   -> live verification
```

A failed validation gate stops deployment. Production smoke checks must exercise the actual binding path, not only compatibility URLs that bypass the dependency.

## 11. Provider adapter rule

Provider integrations should sit behind small interfaces so a provider can be changed without rewriting the application. The first concrete adapter is Razorpay for billing and GitHub for repository data.

## 12. AI delivery model

The repository root `CLAUDE.md` is the permanent rule set. Project decisions that would otherwise be forgotten go into `docs/`. Repeated procedures belong in reusable skills under `skills/` once the directory is established.

## 13. Scope discipline

Do not add broad features until the core flow is reliable:

`Google sign-in -> query -> results -> checkout -> authorization -> webhook -> Pro entitlement`.

That vertical slice is the product's first reliability boundary.
