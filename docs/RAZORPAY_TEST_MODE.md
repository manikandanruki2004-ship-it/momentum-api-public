# Razorpay Test Mode Setup

The production billing code is deployed by the canonical `Deploy Momentum Stack` workflow in this repository.

## GitHub Actions secrets

Add these repository secrets under **Settings → Secrets and variables → Actions**:

- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_STARTER_PLAN_ID`
- `RAZORPAY_PRO_PLAN_ID`

Use Razorpay **Test Mode** identifiers first. Never commit these values.

## Webhook URL

Configure the Razorpay subscription webhook to:

`https://momentum-api-public.manikandanruki2004.workers.dev/webhooks/razorpay`

The public gateway forwards this POST request to the dedicated `momentum-billing` Worker.

## Customer mapping

When a subscription is created for an existing Momentum customer, include this Razorpay subscription note:

```json
{
  "momentum_customer_id": "cus_..."
}
```

The billing Worker uses that ID to associate the subscription with the Momentum account.

## Handled events

Paid access is enabled for:

- `subscription.activated`
- `subscription.resumed`

Paid access is returned to Free for:

- `subscription.halted`
- `subscription.cancelled`
- `subscription.completed`
- `subscription.paused`

Unknown event types are acknowledged but do not change the Momentum tier.

## Security

The Worker validates `X-Razorpay-Signature` with HMAC-SHA256 using the raw request body. It also uses `x-razorpay-event-id` for idempotency and rejects events outside a five-minute timestamp window. These controls follow Razorpay's webhook validation guidance.
