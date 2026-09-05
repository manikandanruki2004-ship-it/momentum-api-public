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
7. User-facing errors stay calm and safe; detailed diagnostics remain server-side.
8. Ship only after automated checks pass and the real browser path is verified.

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
- [ ] Add binding smoke test to the deployment gate.
- [ ] Add idempotent checkout-attempt handling to prevent duplicate subscriptions from repeated clicks.
- [ ] Finish provider adapter separation in the billing service.

### Phase D — security

- [ ] Replace wildcard browser CORS with an explicit origin policy.
- [ ] Add schema validation at all public JSON/query boundaries.
- [ ] Verify HSTS/security headers.
- [ ] Add brute-force controls to authentication.
- [ ] Add automated secret scanning that is tuned for false-positive resistance.

### Phase E — reliability/performance

- [ ] Add timeout helpers to all outbound calls.
- [ ] Add safe retry-with-backoff where justified.
- [ ] Add circuit breaking around repeatedly failing external dependencies.
- [ ] Make remaining shared-state updates atomic.
- [ ] Audit rate limiting per user and per IP.
- [ ] Audit cache TTLs/invalidation and background refresh work.

### Phase F — quality and shipping

- [ ] Add unit tests for billing state transitions.
- [ ] Add integration tests for gateway-to-service bindings.
- [ ] Add Playwright smoke and critical-flow tests.
- [ ] Make deploy depend on green validation and real binding health.
- [ ] Add centralized error tracking and structured JSON logging.

## Acceptance criteria

- The demo renders correctly in a real browser.
- Google sign-in works without exposing secrets.
- Live scans enforce the account's server-side plan limit.
- Clicking Upgrade produces exactly one checkout attempt per user action and opens the valid Razorpay URL.
- Razorpay webhook events are verified, deduplicated, ordered, and reconcile the correct Momentum account.
- Pro access is never granted merely because a browser was redirected.
- Billing or engine dependency failure produces a safe user message and searchable diagnostics.
- A failed CI check blocks deployment.
