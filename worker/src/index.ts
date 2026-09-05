interface Env {
  ENGINE: Fetcher;
  BILLING: Fetcher;
  AUTH: Fetcher;
  RAZORPAY_SUBSCRIPTION_URL?: string;
  PUBLIC_APP_ORIGIN?: string;
}

const baseHeaders = {
  "access-control-allow-headers": "content-type,x-api-key,authorization,x-admin-secret,x-razorpay-signature,x-razorpay-event-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function requestId() { return `req_${crypto.randomUUID().replaceAll("-", "")}`; }

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const configured = String(env.PUBLIC_APP_ORIGIN ?? "https://therandomhuman-hub.github.io").split(",").map(x => x.trim()).filter(Boolean);
  const allowed = origin && configured.includes(origin);
  return allowed ? { ...baseHeaders, "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : { ...baseHeaders };
}

function json(env: Env, origin: string | null, body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(env, origin),
      ...headers,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    const authPaths = ["/auth/config", "/auth/google", "/auth/me", "/auth/logout"];
    const isAuth = authPaths.includes(url.pathname);
    const isCustomerProvisioning = url.pathname === "/internal/customers";
    const isRazorpayWebhook = url.pathname === "/webhooks/razorpay";
    const isBillingClaim = url.pathname === "/billing/claim";
    const isBillingHealth = url.pathname === "/billing/health";
    const isCheckout = url.pathname === "/billing/checkout";
    const isAllowedPost = (isAuth && request.method === "POST") || ((isCustomerProvisioning || isRazorpayWebhook || isBillingClaim || isCheckout) && request.method === "POST");

    if (request.method !== "GET" && !isAllowedPost) {
      return json(env, origin, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed", request_id: id } }, 405, { allow: "GET,POST,OPTIONS", "x-request-id": id });
    }

    if (url.pathname === "/health") {
      return json(env, origin, { status: "ok", service: "momentum-api-public", engine: "service-binding", billing: "service-binding", auth: "service-binding" }, 200, { "x-request-id": id });
    }

    if (url.pathname === "/version") {
      return json(env, origin, { name: "Momentum API", version: "1.7.0", engine: "1.3.1", billing: "1.3.0", auth: "1.1.0" }, 200, { "x-request-id": id });
    }

    if (isBillingHealth && request.method === "GET") {
      const headers = new Headers(request.headers);
      headers.set("x-request-id", id);
      try {
        const probeUrl = new URL("/health", request.url);
        const response = await env.BILLING.fetch(new Request(probeUrl.toString(), { method: "GET", headers, signal: AbortSignal.timeout(5000) }));
        const outHeaders = new Headers(response.headers);
        outHeaders.set("x-request-id", id);
        for (const [key, value] of Object.entries(corsHeaders(env, origin))) outHeaders.set(key, value);
        return new Response(response.body, { status: response.status, headers: outHeaders });
      } catch (error) {
        console.error("billing service binding health check failed", { request_id: id, error });
        return json(env, origin, { error: { code: "BILLING_BINDING_UNAVAILABLE", message: "Billing service is unavailable", request_id: id } }, 503, { "x-request-id": id });
      }
    }

    if (isCheckout && request.method === "GET") {
      const target = env.RAZORPAY_SUBSCRIPTION_URL;
      if (!target) return json(env, origin, { error: { code: "BILLING_NOT_CONFIGURED", message: "Pro checkout is not configured", request_id: id } }, 503, { "x-request-id": id });
      try {
        const u = new URL(target);
        if (u.protocol !== "https:" || !["rzp.io", "pages.razorpay.com"].includes(u.hostname)) throw new Error("invalid checkout URL");
      } catch {
        return json(env, origin, { error: { code: "BILLING_NOT_CONFIGURED", message: "Pro checkout URL is invalid", request_id: id } }, 503, { "x-request-id": id });
      }
      return new Response(null, { status: 302, headers: { Location: target, "cache-control": "no-store", "x-request-id": id, ...corsHeaders(env, origin) } });
    }

    if (!url.pathname.startsWith("/v1/") && !isAuth && !isCustomerProvisioning && !isRazorpayWebhook && !isBillingClaim && !isBillingHealth && !isCheckout) {
      return json(env, origin, { error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });
    }

    const headers = new Headers(request.headers);
    headers.set("x-request-id", id);
    const upstreamRequest = new Request(url.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
      signal: AbortSignal.timeout(8000),
    });

    try {
      let binding = env.ENGINE;
      if (isAuth) binding = env.AUTH;
      else if (isRazorpayWebhook || isBillingClaim || isCheckout) binding = env.BILLING;

      const response = await binding.fetch(upstreamRequest);
      const outHeaders = new Headers(response.headers);
      outHeaders.set("x-request-id", id);
      for (const [key, value] of Object.entries(corsHeaders(env, origin))) outHeaders.set(key, value);
      return new Response(response.body, { status: response.status, headers: outHeaders });
    } catch (error) {
      console.error("service binding failed", { path: url.pathname, request_id: id, error });
      return json(env, origin, { error: { code: "UPSTREAM_UNAVAILABLE", message: "Momentum service unavailable", request_id: id } }, 503, { "x-request-id": id });
    }
  },
};

// Release 2.0.0: explicit origin policy, security headers, and bounded binding calls.
