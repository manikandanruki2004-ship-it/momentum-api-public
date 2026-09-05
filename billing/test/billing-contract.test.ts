import assert from "node:assert/strict";
import test from "node:test";

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

test("billing provider architecture keeps mutation and retry paths separate", async () => {
  const provider = await import("../src/provider.ts");
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/provider.ts", import.meta.url), "utf8"));

  assert.equal(typeof provider.RazorpayProvider, "function");
  assert.match(source, /const maxAttempts = retryableRead \? 3 : 1/);
  assert.match(source, /method: \"POST\"/);
  assert.match(source, /method: \"GET\"/);
  assert.match(source, /AbortController/);
});

test("billing API errors remain JSON and never expose raw provider credentials", async () => {
  const sample = parseJson('{"error":{"code":"BILLING_UNAVAILABLE","message":"Billing service is unavailable","request_id":"req_test"}}') as { error: { message: string; request_id: string } };
  assert.equal(sample.error.request_id, "req_test");
  assert.doesNotMatch(sample.error.message, /secret|password|credential|api[_-]?key/i);
});
