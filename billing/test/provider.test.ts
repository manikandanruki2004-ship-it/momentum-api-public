import assert from "node:assert/strict";
import test from "node:test";
import { RazorpayProvider, type RazorpaySubscriptionPayload } from "../src/provider.ts";

const payload: RazorpaySubscriptionPayload = {
  plan_id: "plan_test",
  total_count: 12,
  quantity: 1,
  customer_notify: false,
  notes: { momentum_customer_id: "cus_test" },
};

test("RazorpayProvider returns parsed successful responses", async () => {
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, async (_url, init) => {
    assert.equal(init?.method, "POST");
    assert.match(String(init?.headers && new Headers(init.headers).get("authorization")), /^Basic /);
    return new Response(JSON.stringify({ id: "sub_test", short_url: "https://rzp.io/rzp/test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await provider.createSubscription(payload);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.data.id, "sub_test");
  assert.equal(result.data.short_url, "https://rzp.io/rzp/test");
});

test("RazorpayProvider fetches an existing subscription through the adapter", async () => {
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, async (url, init) => {
    assert.equal(url, "https://api.razorpay.com/v1/subscriptions/sub_test");
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({ id: "sub_test", status: "active", plan_id: "plan_test", customer_id: "cust_rzp_test", current_start: 1760000000, current_end: 1762678400 }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await provider.getSubscription("sub_test");
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.data.id, "sub_test");
  assert.equal(result.data.status, "active");
  assert.equal(result.data.customer_id, "cust_rzp_test");
});

test("RazorpayProvider retries transient failures for subscription reads", async () => {
  let calls = 0;
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, async (_url, init) => {
    assert.equal(init?.method, "GET");
    calls += 1;
    if (calls < 3) return new Response(JSON.stringify({ error: { code: "TEMPORARY" } }), { status: 503 });
    return new Response(JSON.stringify({ id: "sub_test", status: "active", plan_id: "plan_test" }), { status: 200 });
  });

  const result = await provider.getSubscription("sub_test");
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(calls, 3);
});

test("RazorpayProvider retries rate-limited subscription reads", async () => {
  let calls = 0;
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, async (_url, init) => {
    assert.equal(init?.method, "GET");
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "RATE_LIMIT" } }), { status: 429 });
  });

  const result = await provider.getSubscription("sub_test");
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(calls, 3);
});

test("RazorpayProvider does not retry non-retryable billing failures", async () => {
  let calls = 0;
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "BAD_REQUEST", description: "invalid plan" } }), { status: 400 });
  });

  const result = await provider.createSubscription(payload);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(calls, 1);
});

test("RazorpayProvider rejects malformed subscription ids before network access", async () => {
  let called = false;
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, async () => {
    called = true;
    return new Response("should not be called", { status: 500 });
  });

  const result = await provider.getSubscription("https://attacker.example/sub_test");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.data.error?.code, "INVALID_SUBSCRIPTION_ID");
  assert.equal(called, false);
});

test("RazorpayProvider preserves provider failures", async () => {
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, async () => {
    return new Response(JSON.stringify({ error: { code: "BAD_REQUEST", description: "invalid plan" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await provider.createSubscription(payload);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.data.error?.code, "BAD_REQUEST");
});

test("RazorpayProvider aborts a provider call after the configured timeout", async () => {
  const provider = new RazorpayProvider("rzp_test", "secret", 20, 2500, async (_url, init) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 200);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new DOMException("aborted", "AbortError");
        reject(error);
      }, { once: true });
    });
    return new Response("never");
  });

  await assert.rejects(() => provider.createSubscription(payload), (error: unknown) => {
    return error instanceof DOMException && error.name === "AbortError";
  });
});

test("RazorpayProvider opens its read circuit after repeated failures", async () => {
  let calls = 0;
  const failingFetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "TEMPORARY" } }), { status: 503 });
  };
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 2500, failingFetch);

  await provider.getSubscription("sub_a");
  await provider.getSubscription("sub_b");
  await provider.getSubscription("sub_c");
  const before = calls;
  const blocked = await provider.getSubscription("sub_d");

  assert.equal(calls, before);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.error?.code, "PROVIDER_CIRCUIT_OPEN");
});
