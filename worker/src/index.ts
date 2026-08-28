interface Env {
  ENGINE: Fetcher;
  BILLING: Fetcher;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-api-key,authorization,x-admin-secret,x-razorpay-signature,x-razorpay-event-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function requestId() {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...headers },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const isCustomerProvisioning = url.pathname === "/internal/customers";
    const isRazorpayWebhook = url.pathname === "/webhooks/razorpay";
    if (request.method !== "GET" && !(isCustomerProvisioning && request.method === "POST") && !(isRazorpayWebhook && request.method === "POST")) {
      return json(
        { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported except protected POST endpoints", request_id: id } },
        405,
        { "allow": isCustomerProvisioning || isRazorpayWebhook ? "GET,POST,OPTIONS" : "GET,OPTIONS", "x-request-id": id },
      );
    }

    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET required", request_id: id } }, 405, { "allow": "GET, OPTIONS", "x-request-id": id });
      return json({ status: "ok", service: "momentum-api-public", engine: "service-binding", billing: "service-binding" }, 200, { "x-request-id": id });
    }

    if (url.pathname === "/version") {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET required", request_id: id } }, 405, { "allow": "GET, OPTIONS", "x-request-id": id });
      return json({ name: "Momentum API", version: "1.4.0", engine: "1.3.1", billing: "1.0.0" }, 200, { "x-request-id": id });
    }

    if (!url.pathname.startsWith("/v1/") && !isCustomerProvisioning && !isRazorpayWebhook) {
      return json({ error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });
    }

    const headers = new Headers(request.headers);
    headers.set("x-request-id", id);
    const upstreamRequest = new Request(url.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
    });

    try {
      const binding = isRazorpayWebhook ? env.BILLING : env.ENGINE;
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

// Release 1.4.0: public gateway routes Razorpay webhooks to the dedicated billing Worker.
// Momentum plan limits remain enforced by the private engine: Free=5, Starter=10, Pro=20.
