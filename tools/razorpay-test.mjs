#!/usr/bin/env node

const keyId = process.env.RAZORPAY_TEST_KEY_ID;
const keySecret = process.env.RAZORPAY_TEST_KEY_SECRET;
const apiBase = "https://api.razorpay.com/v1";

if (!keyId || !keySecret) {
  console.error("Missing RAZORPAY_TEST_KEY_ID or RAZORPAY_TEST_KEY_SECRET");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");

async function r(path, options = {}) {
  const res = await fetch(apiBase + path, {
    ...options,
    headers: { Authorization: auth, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${options.method || "GET"} ${path}`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }
  return body;
}

async function main() {
  const suffix = Date.now().toString(36);
  const plan = await r("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: {
        name: `Momentum Pro Test ${suffix}`,
        amount: 100,
        currency: "INR",
        description: "Momentum Pro Test - ₹1 monthly",
      },
      notes: { momentum_tier: "pro", momentum_test: "true" },
    }),
  });

  const link = await r("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: plan.id,
      total_count: 12,
      quantity: 1,
      customer_notify: true,
      notes: { momentum_product: "momentum-pro", momentum_test: "true" },
    }),
  });

  console.log(JSON.stringify({
    test_plan_id: plan.id,
    reusable_subscription_link_id: link.id,
    reusable_subscription_short_url: link.short_url,
  }, null, 2));
  console.log("\nUse the SAME subscription link with multiple test customers.");
  console.log("After each successful test checkout, use the returned Razorpay subscription ID with:");
  console.log("POST /billing/claim with X-API-Key and {\"subscription_id\":\"sub_xxx\"}");
}

main().catch((err) => { console.error(err); process.exit(1); });
