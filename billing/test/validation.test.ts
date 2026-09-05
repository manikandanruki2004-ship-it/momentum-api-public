import assert from "node:assert/strict";
import test from "node:test";

function validHostedCheckout(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "rzp.io" || url.hostname === "pages.razorpay.com");
  } catch {
    return false;
  }
}

test("hosted checkout validation accepts Razorpay URLs", () => {
  assert.equal(validHostedCheckout("https://rzp.io/rzp/example"), true);
  assert.equal(validHostedCheckout("https://pages.razorpay.com/example"), true);
});

test("hosted checkout validation rejects unsafe destinations", () => {
  assert.equal(validHostedCheckout("http://rzp.io/rzp/example"), false);
  assert.equal(validHostedCheckout("https://example.com/checkout"), false);
  assert.equal(validHostedCheckout("javascript:alert(1)"), false);
  assert.equal(validHostedCheckout("not-a-url"), false);
});
