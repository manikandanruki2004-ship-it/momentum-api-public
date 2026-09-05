# Momentum Vibe Engineering Checklist

This is the implementation checklist derived from the supplied engineering-block reference. It is specific to Momentum and is used as a release gate.

## Plan and scope

- [x] Core product slice is explicit.
- [x] Architecture is documented before further structural changes.
- [x] Every significant change has a written implementation plan or decision record.
- [x] Non-core features are kept behind later delivery slices.

## Project hygiene

- [ ] Add lockfiles for each independently installed Node project and move CI from `npm install` to `npm ci`.
- [x] Runtime configuration is kept outside source where supported by the platform.
- [x] Provider secrets stay in platform/GitHub secret stores.
- [x] CI performs tracked-source secret-pattern scanning.

## AI workflow

- [x] Root `CLAUDE.md` contains durable AI/build rules.
- [x] Architecture and decisions live in `docs/`.
- [x] Reusable procedures live under `skills/` where they repeat.

## Structure

- [x] Public gateway is separated from auth, billing, and engine services.
- [ ] Split large service files into domain/provider/persistence modules.
- [x] UI, API routing, business rules, and persistence have explicit ownership boundaries.

## Data

- [x] JSON remains the external API format.
- [x] Relational billing/customer state uses D1.
- [x] Schema changes are represented as ordered migrations.
- [ ] Wrap multi-record entitlement transitions in an atomic unit wherever D1 semantics permit it.
- [x] Lookup-heavy billing paths have indexes.
- [ ] Audit the private engine for N+1 access patterns.
- [x] NoSQL is not introduced without a demonstrated document-shaped requirement.
- [x] Deployment syncs the latest public D1 migrations into the private engine checkout before applying remote migrations.

## Security

- [x] HTTPS service endpoints are used in production.
- [x] HSTS/security headers are checked in production health tests.
- [x] Gateway query boundaries validate type, range, and length before forwarding.
- [x] Auth JSON input validates content type, shape, size, and credential structure before verification.
- [x] Dynamic HTML in the public demo is escaped.
- [x] Production CORS is explicit rather than wildcard.
- [ ] Add SSRF defenses before introducing any user-supplied URL fetcher.
- [x] Session and API credentials are never returned in full after issuance.
- [x] Billing webhooks require signature verification.
- [x] Authentication has IP-keyed brute-force throttling.
- [x] Protected actions check authentication and account state.

## Reliability

- [x] Provider failures are translated into safe user errors.
- [x] Google signing-key fetches and binding health probes have bounded timeouts.
- [x] Razorpay subscription creation has an 8-second provider timeout through the billing adapter.
- [x] Provider subscription reads are behind the same billing adapter and have bounded timeouts.
- [x] Retry-with-backoff is limited to the idempotent Razorpay subscription read path and capped at a small number of attempts.
- [x] Retried subscription reads use a shorter per-attempt timeout so the full retry budget remains below the gateway's 8-second upstream deadline.
- [x] Razorpay read failures now open a small bounded circuit breaker before repeated dependency calls continue.
- [x] Provider event IDs are used for webhook deduplication.
- [x] Checkout persistence failure cannot hide a successfully created Razorpay checkout URL.
- [x] Concurrent checkout attempts use a D1-backed per-customer lease and can reuse an existing checkout URL.
- [ ] Audit remaining shared-state updates for races and make read/modify/write sequences atomic.
- [x] Authenticated customers can request a bounded Razorpay subscription status refresh through `/billing/status`.
- [x] Production billing secrets are synchronized by the primary deployment workflow instead of a separate autonomous repair workflow.

## Performance

- [x] Repository activity caching exists in the engine architecture.
- [x] Result counts are bounded by the authenticated plan.
- [x] Gateway applies explicit edge rate limits per client IP and route; account/user-specific limits remain enforced by the authenticated services.
- [ ] Add stronger per-user limits at the public gateway once authentication identity is available before routing.
- [ ] Add pagination to any future endpoint whose result set can grow without a hard cap.
- [x] Non-critical refresh work has a background-job architecture in the engine.

## Observability

- [x] Public requests carry request IDs.
- [x] Cloudflare Worker observability is enabled in deployment configuration.
- [x] Billing binding health is monitored.
- [x] Auth binding health is monitored.
- [ ] Standardize structured JSON logging fields across all Workers.
- [ ] Add centralized exception/error tracking with safe customer messages.
- [x] Provider event IDs and request IDs are available in the billing incident trail.
- [x] Gateway rate-limit rejections are logged with route, scope, and request ID.

## Quality and shipping

- [x] Typechecks run for core Workers during CI/deployment.
- [x] Engineering-contract checks run in CI.
- [x] Billing provider unit tests cover create, read, failure, malformed-id, timeout, and bounded-retry behavior.
- [x] Add integration-style health checks for binding-to-service paths.
- [x] Add Playwright smoke coverage for the public demo and critical anonymous boundaries.
- [x] CI/CD deployment exists.
- [x] Deployment smoke tests verify gateway version plus direct billing/auth binding health.
- [x] Post-deploy production release gate verifies the deployed gateway, bindings, security headers, protected routes, and current browser UI markers.
- [x] Production health endpoints exist for the gateway, billing, and auth services.
- [x] A scheduled production smoke test fails when billing or auth is unavailable.
- [x] Release contract validates the billing status route and gateway routing.
- [x] CI validates the presence of the gateway rate-limit contract.
- [x] Provider tests validate circuit opening after repeated read failures.

## Provider abstraction

- [x] Create a `BillingProvider` interface.
- [x] Implement Razorpay behind the provider interface.
- [x] Keep provider URLs out of presentation logic except for the validated hosted checkout destination.
- [x] Keep subscription lookup behind the provider interface rather than direct external calls in route logic.
- [ ] Make provider failover possible without changing the public API contract.

## Browser verification

The critical browser journey is:

```text
Open site
  -> Preview works
  -> Sign in with Google
  -> Run live query
  -> Click Upgrade
  -> Obtain real Razorpay checkout URL
  -> Complete/exit authorization
  -> Return to Momentum
  -> Refresh account state
  -> Pro state reflects verified billing processing
```

A build is not complete merely because TypeScript compiles. The browser path and the real service-binding path must be exercised.

## Release gate

A production release should satisfy:

`plan -> validate -> test -> browser smoke -> deploy -> binding health -> live verification`

The post-deploy gate is implemented in `.github/workflows/release-gate.yml`. A successful deploy is not treated as fully released until the gate passes.
