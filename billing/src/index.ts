interface Env {
  DB: D1Database;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RAZORPAY_STARTER_PLAN_ID?: string;
  RAZORPAY_PRO_PLAN_ID?: string;
}

type SubscriptionEntity = {
  id?: string;
  plan_id?: string;
  customer_id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  notes?: Record<string, unknown>;
};

type SubscriptionEvent = {
  event?: string;
  created_at?: number;
  payload?: { subscription?: { entity?: SubscriptionEntity } };
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

function requestId() {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256(body: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
}

function planForEvent(env: Env, planId: string): "starter" | "pro" | null {
  if (env.RAZORPAY_STARTER_PLAN_ID && planId === env.RAZORPAY_STARTER_PLAN_ID) return "starter";
  if (env.RAZORPAY_PRO_PLAN_ID && planId === env.RAZORPAY_PRO_PLAN_ID) return "pro";
  return null;
}

function shouldActivate(eventType: string): boolean {
  return eventType === "subscription.activated" || eventType === "subscription.resumed";
}

function shouldDeactivate(eventType: string): boolean {
  return eventType === "subscription.halted" || eventType === "subscription.cancelled" || eventType === "subscription.completed" || eventType === "subscription.paused";
}

async function processEvent(env: Env, eventId: string, event: SubscriptionEvent): Promise<void> {
  const eventType = String(event.event ?? "unknown");
  const subscription = event.payload?.subscription?.entity;
  if (!subscription?.id) throw new Error("Missing subscription entity id");

  const subscriptionId = subscription.id;
  const planId = String(subscription.plan_id ?? "");
  const razorpayCustomerId = subscription.customer_id ? String(subscription.customer_id) : null;
  const notes = subscription.notes ?? {};

  const existing = await env.DB.prepare(
    `SELECT customer_id, tier FROM razorpay_subscriptions WHERE subscription_id = ? LIMIT 1`,
  ).bind(subscriptionId).first<{ customer_id: string; tier: string }>();

  const notedCustomerId = typeof notes.momentum_customer_id === "string" ? notes.momentum_customer_id : null;
  const customerId = existing?.customer_id ?? notedCustomerId;
  if (!customerId) throw new Error("Missing momentum_customer_id mapping");

  let tier: "free" | "starter" | "pro" | null = null;
  if (shouldActivate(eventType)) tier = planForEvent(env, planId);
  if (shouldDeactivate(eventType)) tier = "free";
  if (shouldActivate(eventType) && !tier) throw new Error("Unknown Razorpay plan id");
  if (!tier && existing && ["starter", "pro", "free"].includes(existing.tier)) tier = existing.tier as "free" | "starter" | "pro";

  const now = new Date().toISOString();
  const storedTier = tier ?? "unknown";
  const currentStatus = String(subscription.status ?? eventType);

  await env.DB.prepare(
    `INSERT INTO razorpay_subscriptions(
       subscription_id, customer_id, razorpay_customer_id, plan_id, tier, status,
       current_start, current_end, created_at, updated_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(subscription_id) DO UPDATE SET
       customer_id=excluded.customer_id,
       razorpay_customer_id=excluded.razorpay_customer_id,
       plan_id=excluded.plan_id,
       tier=excluded.tier,
       status=excluded.status,
       current_start=excluded.current_start,
       current_end=excluded.current_end,
       updated_at=excluded.updated_at`,
  ).bind(
    subscriptionId,
    customerId,
    razorpayCustomerId,
    planId,
    storedTier,
    currentStatus,
    subscription.current_start ?? null,
    subscription.current_end ?? null,
    now,
    now,
  ).run();

  if (shouldActivate(eventType) || shouldDeactivate(eventType)) {
    await env.DB.prepare(
      `UPDATE customers
       SET tier = ?,
           monthly_quota = (SELECT monthly_quota FROM plans WHERE tier = ? AND active = 1),
           rate_limit_per_minute = (SELECT rate_limit_per_minute FROM plans WHERE tier = ? AND active = 1)
       WHERE id = ? AND active = 1`,
    ).bind(tier, tier, tier, customerId).run();
  }

  await env.DB.prepare(
    `UPDATE razorpay_webhook_events SET status='processed', processed_at=? WHERE event_id=?`,
  ).bind(now, eventId).run();
}

async function webhook(request: Request, env: Env, id: string): Promise<Response> {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Razorpay webhook secret is not configured", request_id: id } }, 503, { "x-request-id": id });

  const signature = request.headers.get("X-Razorpay-Signature") ?? request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";
  const rawBody = await request.text();
  const expected = await hmacSha256(secret, rawBody);

  if (!signature || !safeEqual(expected, signature)) {
    return json({ error: { code: "INVALID_SIGNATURE", message: "Invalid Razorpay webhook signature", request_id: id } }, 401, { "x-request-id": id });
  }
  if (!eventId) return json({ error: { code: "MISSING_EVENT_ID", message: "Missing x-razorpay-event-id header", request_id: id } }, 400, { "x-request-id": id });

  let event: SubscriptionEvent;
  try {
    event = JSON.parse(rawBody) as SubscriptionEvent;
  } catch {
    return json({ error: { code: "INVALID_JSON", message: "Webhook body must be valid JSON", request_id: id } }, 400, { "x-request-id": id });
  }

  const createdAt = Number(event.created_at ?? 0);
  if (createdAt > 0 && Math.abs(Date.now() / 1000 - createdAt) > 300) {
    return json({ error: { code: "STALE_EVENT", message: "Webhook event is outside the five-minute replay window", request_id: id } }, 400, { "x-request-id": id });
  }

  const payloadHash = await sha256(rawBody);
  const eventType = String(event.event ?? "unknown");
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO razorpay_webhook_events(event_id,event_type,status,received_at,payload_sha256) VALUES(?,?,?,?,?)`,
  ).bind(eventId, eventType, "received", new Date().toISOString(), payloadHash).run();

  if (claim.meta.changes !== 1) {
    const existing = await env.DB.prepare(`SELECT status FROM razorpay_webhook_events WHERE event_id=? LIMIT 1`).bind(eventId).first<{ status: string }>();
    if (existing?.status === "failed") {
      await env.DB.prepare(`UPDATE razorpay_webhook_events SET status='received', error_message=NULL WHERE event_id=?`).bind(eventId).run();
    } else {
      return json({ status: "ok", duplicate: true, request_id: id }, 200, { "x-request-id": id });
    }
  }

  try {
    await processEvent(env, eventId, event);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await env.DB.prepare(
      `UPDATE razorpay_webhook_events SET status='failed', processed_at=?, error_message=? WHERE event_id=?`,
    ).bind(new Date().toISOString(), message.slice(0, 500), eventId).run();
    throw error;
  }

  return json({ status: "processed", request_id: id }, 200, { "x-request-id": id });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok", service: "momentum-billing" }, 200, { "x-request-id": id });
    if (url.pathname === "/webhooks/razorpay" && request.method === "POST") {
      try {
        return await webhook(request, env, id);
      } catch (error) {
        console.error("Razorpay webhook processing failed", error);
        return json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: "Webhook processing failed; retry the event", request_id: id } }, 500, { "x-request-id": id });
      }
    }
    return json({ error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });
  },
};
