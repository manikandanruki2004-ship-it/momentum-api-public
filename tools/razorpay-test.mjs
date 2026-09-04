#!/usr/bin/env node

const keyId = process.env.RAZORPAY_TEST_KEY_ID;
const keySecret = process.env.RAZORPAY_TEST_KEY_SECRET;
const customerId = process.env.MOMENTUM_TEST_CUSTOMER_ID;
const apiBase = "https://api.razorpay.com/v1";

if (!keyId || !keySecret) {
  console.error("Missing RAZORPAY_TEST_KEY_ID or RAZORPAY_TEST_KEY_SECRET");
  process.exit(1);
}
if (!customerId) {
  console.error("Missing MOMENTUM_TEST_CUSTOMER_ID");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");

async function r(path, options = {}) {
  const res = await fetch(apiBase + path, {
    ...options,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
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
  const starter = await r("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: {
        name: `Momentum Test Starter ${suffix}`,
        amount: 100,
        currency: "INR",
        description: "Momentum Test Starter - ₹1 monthly",
      },
      notes: { momentum_tier: "starter", momentum_test: "true" },
    }),
  });

  const pro = await r("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: {
        name: `Momentum Test Pro ${suffix}`,
        amount: 100,
        currency: "INR",
        description: "Momentum Test Pro - ₹1 monthly",
      },
      notes: { momentum_tier: "pro", momentum_test: "true" },
    }),
  });

  const mkLink = async (plan, tier) => r("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: plan.id,
      total_count: 1,
      quantity: 1,
      customer_notify: false,
      notes: {
        momentum_customer_id: customerId,
        momentum_tier: tier,
        momentum_test: "true",
      },
    }),
  });

  const starterLink = await mkLink(starter, "starter");
  const proLink = await mkLink(pro, "pro");

  console.log("Razorpay Test Mode setup complete\n");
  console.log(JSON.stringify({
    starter_plan_id: starter.id,
    starter_link_id: starterLink.id,
    starter_short_url: starterLink.short_url,
    pro_plan_id: pro.id,
    pro_link_id: proLink.id,
    pro_short_url: proLink.short_url,
  }, null, 2));
  console.log("\nOpen the Starter link first, complete the Test Mode authorisation, and wait for Momentum to receive the webhook.");
  console.log("Then open the Pro link and complete the Test Mode authorisation to test replacement upgrade handling.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
