import assert from "node:assert/strict";
import test from "node:test";
import { RazorpayProvider } from "../src/provider.ts";

test("read circuit allows only one probe after cooldown", async () => {
  let calls = 0;
  const provider = new RazorpayProvider("rzp_test", "secret", 1000, 50, async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "TEMPORARY" } }), { status: 503 });
  });

  await provider.getSubscription("sub_a");
  await provider.getSubscription("sub_b");
  await provider.getSubscription("sub_c");
  const beforeCooldownProbe = calls;
  assert.equal(beforeCooldownProbe, 9);

  await new Promise(resolve => setTimeout(resolve, 5100));
  const [first, second] = await Promise.all([
    provider.getSubscription("sub_d"),
    provider.getSubscription("sub_e"),
  ]);

  assert.equal(calls, beforeCooldownProbe + 1);
  assert.equal(first.ok || second.ok, false);
  assert.equal([first, second].some(result => result.data.error?.code === "PROVIDER_CIRCUIT_OPEN"), true);
});
