interface Env {
  ENGINE: Fetcher;
  BILLING: Fetcher;
  AUTH: Fetcher;
  RAZORPAY_SUBSCRIPTION_URL?: string;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-api-key,authorization,x-admin-secret,x-razorpay-signature,x-razorpay-event-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function requestId() { return `req_${crypto.randomUUID().replaceAll("-", "")}`; }
function json(body: unknown, status = 200, headers: HeadersInit = {}) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...headers } }); }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const authPaths = ["/auth/config", "/auth/google", "/auth/me", "/auth/logout"];
    const isAuth = authPaths.includes(url.pathname);
    const isCustomerProvisioning = url.pathname === "/internal/customers";
    const isRazorpayWebhook = url.pathname === "/webhooks/razorpay";
    const isBillingClaim = url.pathname === "/billing/claim";
    const isCheckout = url.pathname === "/billing/checkout";
    const isAllowedPost = (isAuth && request.method === "POST") || ((isCustomerProvisioning || isRazorpayWebhook || isBillingClaim || isCheckout) && request.method === "POST");
    if (request.method !== "GET" && !isAllowedPost) return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed", request_id: id } }, 405, { allow: "GET,POST,OPTIONS", "x-request-id": id });

    if (url.pathname === "/health") return json({ status: "ok", service: "momentum-api-public", engine: "service-binding", billing: "service-binding", auth: "service-binding" }, 200, { "x-request-id": id });
    if (url.pathname === "/version") return json({ name: "Momentum API", version: "1.7.0", engine: "1.3.1", billing: "1.3.0", auth: "1.1.0" }, 200, { "x-request-id": id });

    if (isCheckout && request.method === "GET") {
      const target = env.RAZORPAY_SUBSCRIPTION_URL;
      if (!target) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Pro checkout is not configured", request_id: id } }, 503, { "x-request-id": id });
      try {
        const u = new URL(target);
        if (u.protocol !== "https:" || !["rzp.io", "pages.razorpay.com"].includes(u.hostname)) throw new Error("invalid checkout URL");
      } catch {
        return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Pro checkout URL is invalid", request_id: id } }, 503, { "x-request-id": id });
      }
      return new Response(null, { status: 302, headers: { Location: target, "cache-control": "no-store", "x-request-id": id } });
    }

    if (!url.pathname.startsWith("/v1/") && !isAuth && !isCustomerProvisioning && !isRazorpayWebhook && !isBillingClaim && !isCheckout) return json({ error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });

    const headers = new Headers(request.headers);
    headers.set("x-request-id", id);
    const upstreamRequest = new Request(url.toString(), { method: request.method, headers, body: request.method === "GET" ? undefined : request.body });
    try {
      let binding = env.ENGINE;
      if (isAuth) binding = env.AUTH;
      else if (isRazorpayWebhook || isBillingClaim || isCheckout) binding = env.BILLING;
      const response = await binding.fetch(upstreamRequest);
      const outHeaders = new Headers(response.headers);
      outHeaders.set("x-request-id", id);
      for (const [key, value] of Object.entries(corsHeaders)) outHeaders.set(key, value);
      return new Response(response.body, { status: response.status, headers: outHeaders });
    } catch (error) {
      console.error("service binding failed", error);
      return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Momentum service unavailable", request_id: id } }, 503, { "x-request-id": id });
    }
  },
};

// Release 1.9.1: POST /billing/checkout creates a customer-specific Razorpay subscription; GET remains a generic compatibility fallback for health checks.
