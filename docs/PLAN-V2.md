# Momentum v2 — Plan Before Code

## Goal

Turn the current Momentum demo and API stack into a dependable, production-oriented SaaS vertical slice using the engineering-block principles in the supplied reference.

## Core slice

`Google sign-in -> bounded live scan -> Razorpay checkout -> authorization -> verified webhook -> Pro entitlement -> account reflects Pro`

## Decisions

1. Keep the public browser app thin.
2. Keep gateway, auth, billing, and engine responsibilities separate.
3. Keep D1 as the relational source of truth for customer/billing state.
4. Keep external providers behind adapters so they can be swapped later.
5. Make provider events idempotent and ordered.
6. Never let a local persistence failure hide a successful Razorpay checkout URL.
7. Validate at system boundaries before domain logic runs.
8. Bound external network calls with timeouts.
9. Protect authentication from repeated failed attempts.
10. User-facing errors stay calm and safe; detailed diagnostics remain server-side.
11. Ship only after automated checks pass and the real browser path is verified.
12. Do not automatically retry Razorpay subscription creation because it is a remote mutation; retries are reserved for reads or operations with proven idempotency.

## Delivery phases

### Phase A — foundation

- [x] Permanent AI rules in `CLAUDE.md`.
- [x] Architecture in `docs/ARCHITECTURE.md`.
- [x] Engineering checklist in `docs/ENGINEERING-CHECKLIST.md`.
- [x] Reusable secure-build skill.
- [x] CI hygiene and typechecks.

### Phase B — product interface

- [x] Replace the dense demo layout with a clear editorial interface.
- [x] Separate account, scan, Pro, results, and trust concepts visually.
- [x] Make errors visible without exposing implementation details.
- [x] Keep sample data available without authentication so the page is useful immediately.

### Phase C — billing reliability

- [x] Binding-level health probe.
- [x] Customer-ID reconciliation migration.
- [x] Checkout source repair path.
- [x] Binding smoke test in the post-deploy release gate.
- [x] Idempotent checkout-attempt handling with a per-customer D1 lease and reusable checkout URL.
- [x] Razorpay billing calls isolated behind a `BillingProvider` adapter.
- [x] Razorpay subscription reads also use the billing adapter with bounded timeouts.

### Phase D — security

- [x] Replace wildcard browser CORS with an explicit production origin policy.
- [x] Add gateway query and auth-request boundary validation.
- [x] Verify HSTS/security headers in production health/release gates.
- [x] Add IP-keyed brute-force throttling to Google sign-in.
- [x] Add automated secret-pattern scanning with a false-positive-resistant scope.

### Phase E — reliability/performance

- [x] Razorpay and critical binding/provider calls have bounded timeouts.
- [ ] Add safe retry-with-backoff where justified, limited to idempotent reads/operations.
- [ ] Add circuit breaking around repeatedly failing external dependencies.
- [ ] Make remaining shared-state updates atomic.
- [ ] Audit rate limiting per user and per IP.
- [x] Preserve bounded result counts and background refresh architecture; audit cache TTLs/invalidation next.

### Phase F — quality and shipping

- [ ] Add unit tests for billing state transitions.
- [x] Add integration-style tests for gateway-to-service binding health.
- [x] Add Playwright smoke coverage for the browser shell and critical anonymous boundaries.
- [x] Add a post-deploy production release gate for binding/security/browser checks.
- [ ] Add centralized error tracking and standardized structured JSON logging.

## Acceptance criteria

- The demo renders correctly in a real browser.
- Google sign-in works without exposing secrets and repeated invalid attempts are throttled.
- Live scans enforce the account's server-side plan limit.
- Clicking Upgrade produces one active checkout attempt per account and opens the valid Razorpay URL.
- Razorpay webhook events are verified, deduplicated, ordered, and reconcile the correct Momentum account.
- Pro access is never granted merely because a browser was redirected.
- Billing or engine dependency failure produces a safe user message and searchable diagnostics.
- A failed validation or health gate blocks release.
