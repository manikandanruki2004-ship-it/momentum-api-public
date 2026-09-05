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
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, async (_url, init) => {
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

test("RazorpayProvider preserves provider failures", async () => {
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, async () => {
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
  const provider = new RazorpayProvider("rzp_test", "secret", 20, async (_url, init) => {
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
