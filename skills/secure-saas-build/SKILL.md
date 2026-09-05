# Secure SaaS Build Skill

Use this procedure when adding or changing a production feature in Momentum.

## Inputs

- Feature request
- Existing architecture in `docs/ARCHITECTURE.md`
- Root rules in `CLAUDE.md`
- Current API/data contracts

## Procedure

1. Write the smallest useful feature slice in a short markdown plan.
2. Identify the UI, gateway, domain, provider, and persistence boundaries touched by the feature.
3. Define JSON request/response shapes and validation rules.
4. Identify secrets, permissions, external calls, shared-state writes, and failure modes before coding.
5. Add or update migrations before code that depends on new schema state.
6. Implement domain logic behind a narrow service/provider interface.
7. Add bounded timeouts to outbound calls; add retries only where repetition is safe.
8. Make retryable writes idempotent and protect read/modify/write sequences from races.
9. Add structured request/error logging without logging credentials or sensitive payloads.
10. Add unit/integration coverage for the critical state transitions.
11. Add browser coverage for any user-visible workflow.
12. Run CI; only deploy from a green build.
13. Exercise the real production binding/provider path with a safe smoke test.
14. Record any new architecture decisions under `docs/` so the next AI session does not have to rediscover them.

## Billing-specific safety

- Razorpay is a provider, not the source of truth for Momentum entitlements; verified webhook events drive entitlement state.
- Never expose Razorpay secrets to the browser.
- Never treat a browser redirect as proof of payment.
- Preserve a valid provider checkout URL even when best-effort local bookkeeping temporarily fails.
- Deduplicate provider events by event ID and maintain event ordering information.
- Do not activate Pro for a plan ID that is not explicitly allow-listed.

## Completion standard

The feature is complete only when its documented acceptance checks pass, the critical browser flow works, and the production dependency path has been exercised. A compile-only success is insufficient.
