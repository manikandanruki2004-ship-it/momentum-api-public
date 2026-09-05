# Momentum Release Readiness

This document is the final pre-production verification procedure for the core vertical slice.

## Required sequence

1. `Momentum CI` passes.
2. `Momentum Browser E2E` passes.
3. Production stack deploy completes.
4. `Production Health Checks` confirms gateway, auth, billing, headers, and protected boundaries.
5. Test one real Google-authenticated checkout from the browser.
6. Confirm the browser reaches the Razorpay hosted checkout URL.
7. Complete or exit the authorization flow.
8. Confirm a verified Razorpay webhook is processed.
9. Confirm the Momentum account reflects the resulting entitlement only from verified billing state.
10. Record the request/event IDs for any failure.

## Release-stop conditions

Stop the release when any of the following occurs:

- a CI or browser test fails;
- a service binding health check fails;
- the checkout endpoint creates a provider subscription but does not return its hosted checkout URL;
- a duplicate checkout can be created by concurrent requests for the same customer;
- an unverified browser redirect changes the customer's entitlement;
- a terminal Razorpay event fails to remove the paid entitlement;
- the production release gate cannot verify the deployed version.

## Manual browser acceptance

Use a dedicated test account and Razorpay test-mode credentials. Do not reuse a production customer for repeated checkout experiments.

Expected browser path:

`sign in -> run live scan -> upgrade -> Razorpay authorization -> return -> account refresh`

Expected billing path:

`subscription created -> webhook verified -> event recorded -> subscription reconciled -> entitlement updated`

## Evidence to retain

Record the deployed commit SHA, workflow run URLs, browser-test result, request ID, Razorpay subscription ID, and Razorpay event ID. Do not record API keys, secrets, or full session tokens.
