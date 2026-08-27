interface Env {
  ENGINE: Fetcher;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-api-key,authorization,x-admin-secret",
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
    if (request.method !== "GET" && !(isCustomerProvisioning && request.method === "POST")) {
      return json(
        { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported except protected customer provisioning", request_id: id } },
        405,
        { "allow": isCustomerProvisioning ? "GET, POST, OPTIONS" : "GET, OPTIONS", "x-request-id": id },
      );
    }

    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET required", request_id: id } }, 405, { "allow": "GET, OPTIONS", "x-request-id": id });
      return json({ status: "ok", service: "momentum-api-public", engine: "service-binding" }, 200, { "x-request-id": id });
    }

    if (url.pathname === "/version") {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET required", request_id: id } }, 405, { "allow": "GET, OPTIONS", "x-request-id": id });
      return json({ name: "Momentum API", version: "1.2.5", engine: "1.2.5" }, 200, { "x-request-id": id });
    }

    if (!url.pathname.startsWith("/v1/") && !isCustomerProvisioning) {
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
      const response = await env.ENGINE.fetch(upstreamRequest);
      const outHeaders = new Headers(response.headers);
      outHeaders.set("x-request-id", id);
      for (const [key, value] of Object.entries(corsHeaders)) outHeaders.set(key, value);
      return new Response(response.body, { status: response.status, headers: outHeaders });
    } catch (error) {
      console.error("engine service binding failed", error);
      return json({ error: { code: "ENGINE_UNAVAILABLE", message: "Momentum engine unavailable", request_id: id } }, 503, { "x-request-id": id });
    }
  },
};

// Release 1.2.7: fix TypeScript method narrowing while preserving protected customer provisioning proxy.