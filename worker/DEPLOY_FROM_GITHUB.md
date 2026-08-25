# Deploy the public gateway from GitHub

This repository is the public API contract and gateway. It deploys through GitHub Actions to Cloudflare Workers.

The gateway calls the private `momentum-engine` Worker through a Cloudflare Service Binding. The private engine is not reached through a public HTTP URL.

## GitHub repository secrets required

Add these Actions secrets under **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The private engine has its own secrets in the private repository. Do not copy them into this repository.

## Deployment order

1. Deploy `momentum-engine` from its private repository first.
2. Confirm that its GitHub Actions deployment succeeds.
3. Run the `Deploy Public Momentum Gateway to Cloudflare` workflow in this repository.
4. The gateway deploys with the `ENGINE` Service Binding pointing at `momentum-engine`.
5. Test `/health`, `/version`, then `/v1/momentum` with a customer API key.

The public repository must never contain GitHub API credentials, customer records, API-key pepper, admin secrets, or proprietary scoring implementation.
