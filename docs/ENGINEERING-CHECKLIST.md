# Momentum Vibe Engineering Checklist

This is the implementation checklist derived from the supplied engineering-block reference. It is intentionally specific to Momentum rather than a copy of the source material.

## Plan and scope

- [x] Core product slice is explicit.
- [x] Architecture is documented before further structural changes.
- [ ] Every new feature begins with a short `.md` implementation plan.
- [ ] Non-core feature requests are split into later slices instead of expanding the production surface blindly.

## Project hygiene

- [x] GitHub is the source-control and deployment history.
- [ ] Add lockfiles for each independently installed Node project.
- [ ] Keep runtime configuration outside source.
- [x] Keep provider secrets in platform/GitHub secret stores.
- [ ] Add automated secret scanning to CI.

## AI workflow

- [x] Root `CLAUDE.md` contains durable project rules.
- [x] Architecture decisions live in `docs/`.
- [ ] Add reusable `skills/` only for procedures that repeat.

## Structure

- [x] Public gateway is separated from auth, billing, and engine services.
- [ ] Split large service files into domain/provider/persistence modules.
- [ ] Keep UI, API routing, business rules, and persistence in separate layers.

## Data

- [x] JSON remains the external API format.
- [x] Relational billing/customer state uses D1.
- [x] Schema changes are represented as ordered migrations.
- [ ] Wrap multi-record entitlement transitions in an atomic unit wherever the D1 semantics permit it.
- [x] Add indexes for lookup-heavy billing paths.
- [ ] Audit for N+1 access patterns in engine queries.
- [x] Avoid introducing NoSQL unless the data shape actually needs document semantics.

## Security

- [x] HTTPS service endpoints are used in production.
- [ ] Add explicit HSTS/security-header verification to production smoke tests.
- [ ] Validate every JSON/query boundary with a schema.
- [x] Escape dynamic HTML in the public demo.
- [ ] Replace wildcard gateway CORS with an explicit production origin allowlist and a separate local-development policy.
- [ ] Add SSRF defenses before introducing any user-supplied URL fetcher.
- [x] Session and API credentials are never returned in full after issuance.
- [x] Billing webhooks require signature verification.
- [ ] Add explicit brute-force protection to authentication endpoints.
- [x] Protected actions check authentication and account state.

## Reliability

- [x] Provider failures are translated into safe user errors.
- [ ] Add bounded timeout helpers for outbound `fetch` calls.
- [ ] Add retry-with-backoff only to safe/idempotent provider reads and mutations.
- [ ] Add a small circuit-breaker abstraction for repeatedly failing external dependencies.
- [x] Provider event IDs are used for webhook deduplication.
- [x] Checkout persistence failure cannot hide a successfully created Razorpay checkout URL.
- [ ] Audit every shared-state update for races and make the read/modify/write sequence atomic.

## Performance

- [x] Repository activity caching exists in the engine architecture.
- [x] Rate limits exist at the plan level.
- [ ] Enforce per-user and per-IP limits on public endpoints.
- [x] Result counts are bounded.
- [ ] Add pagination to any future list endpoint that can grow beyond a bounded response.
- [ ] Move non-critical expensive refresh work to background jobs.

## Observability

- [x] Public requests carry request IDs.
- [x] Cloudflare Worker observability is enabled in deployment configuration.
- [ ] Standardize structured JSON logging fields across Workers.
- [ ] Add centralized exception/error tracking with safe user-facing messages.
- [ ] Include provider event IDs and request IDs in every billing incident trail.

## Quality and shipping

- [x] Typechecks run for core Workers during the stack deployment workflow.
- [ ] Add unit tests for billing state transitions and request validation.
- [ ] Add integration tests for binding-to-service paths.
- [ ] Add Playwright tests for Google sign-in state, query flow, upgrade click, and checkout navigation.
- [x] CI/CD deployment exists.
- [ ] Make deployment conditional on all validation gates passing.
- [x] Production health endpoints exist for the gateway and billing service.
- [ ] Add a service-binding smoke test that fails when `BILLING` or `AUTH` is unavailable.

## Provider abstraction

- [ ] Create a `BillingProvider` interface.
- [ ] Implement Razorpay behind the interface.
- [ ] Keep provider response shapes out of UI components.
- [ ] Make failover possible without changing the public API contract.

## Browser verification

The critical browser journey is:

```text
Open site
  -> Sign in with Google
  -> Run live query
  -> Click Upgrade
  -> Obtain real Razorpay checkout URL
  -> Navigate to hosted checkout
  -> Complete/exit authorization
  -> Return to Momentum
  -> Refresh account state
  -> Pro state is reflected only after verified billing processing
```

A build should not be called complete merely because TypeScript compiles. The browser path must render and the real binding/provider path must be exercised.
