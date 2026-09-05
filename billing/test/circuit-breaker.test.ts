import assert from "node:assert/strict";
import test from "node:test";
import { RazorpayProvider } from "../src/provider.ts";

test("read circuit allows only one probe after cooldown", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: `sub_${calls}`, status: "active", plan_id: "plan_test" }), { status: 200 });
  };

  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 50, fetchImpl);

  const initial = new RazorpayProvider("rzp_test", "secret", 1000, 50, async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "TEMPORARY" } }), { status: 503 });
  });
  await initial.getSubscription("sub_a");
  await initial.getSubscription("sub_b");
  await initial.getSubscription("sub_c");

  await new Promise(resolve => setTimeout(resolve, 5100));
  const results = await Promise.all([provider.getSubscription("sub_d"), provider.getSubscription("sub_e")]);
  assert.equal(results.filter(result => result.ok).length, 2);
});
