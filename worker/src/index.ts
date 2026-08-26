interface Env {
  ENGINE: Fetcher;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-api-key,authorization",
  "access-control-allow-methods": "GET,OPTIONS",
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
    if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported", request_id: id } }, 405, { "allow": "GET, OPTIONS", "x-request-id": id });

    if (url.pathname === "/health") {
      return json({ status: "ok", service: "momentum-api-public", engine: "service-binding" }, 200, { "x-request-id": id });
    }

    if (url.pathname === "/version") {
      return json({ name: "Momentum API", version: "1.2.1", engine: "1.2.1" }, 200, { "x-request-id": id });
    }

    if (!url.pathname.startsWith("/v1/")) {
      return json({ error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });
    }

    const headers = new Headers(request.headers);
    headers.set("x-request-id", id);
    const upstreamRequest = new Request(url.toString(), { method: "GET", headers });

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

// Release 1.2.1: atomic D1-backed per-customer rate limiting is deployed by the canonical stack workflow.
