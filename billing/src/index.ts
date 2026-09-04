interface Env {
  DB: D1Database;
  API_KEY_PEPPER?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RAZORPAY_PRO_PLAN_ID?: string;
}

type Sub = {
  id?: string;
  plan_id?: string;
  customer_id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
};

type Event = {
  event?: string;
  created_at?: number;
  payload?: { subscription?: { entity?: Sub } };
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const requestId = () => `req_${crypto.randomUUID().replaceAll("-", "")}`;
const nowIso = () => new Date().toISOString();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}
function eq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function hashKey(key: string, pepper: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(key)));
}
function tierFor(env: Env, planId: string): "pro" | null {
  return env.RAZORPAY_PRO_PLAN_ID && planId === env.RAZORPAY_PRO_PLAN_ID ? "pro" : null;
}
function isActiveEvent(e: string) { return e === "subscription.activated" || e === "subscription.resumed" || e === "subscription.charged" || e === "subscription.updated"; }
function isSuspendEvent(e: string) { return e === "subscription.paused" || e === "subscription.pending" || e === "subscription.halted"; }
function isTerminalEvent(e: string) { return e === "subscription.cancelled" || e === "subscription.completed" || e === "subscription.expired"; }
function isPreEvent(e: string) { return e === "subscription.created" || e === "subscription.authenticated"; }

async function markEvent(env: Env, eventId: string, status: string, error: string | null = null) {
  await env.DB.prepare("UPDATE razorpay_webhook_events SET status=?,processed_at=?,error_message=? WHERE event_id=?").bind(status, nowIso(), error, eventId).run();
}
async function syncCustomer(env: Env, customerId: string, active: boolean) {
  await env.DB.prepare(`UPDATE customers SET tier='pro', monthly_quota=(SELECT monthly_quota FROM plans WHERE tier='pro' AND active=1), rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier='pro' AND active=1), active=? WHERE id=?`).bind(active ? 1 : 0, customerId).run();
}

async function storeUnclaimed(env: Env, sid: string, rpc: string | null, pid: string, status: string, start: number | null | undefined, end: number | null | undefined, created: number) {
  const existing = await env.DB.prepare("SELECT plan_id,status,last_event_created_at FROM razorpay_unclaimed_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{plan_id:string;status:string;last_event_created_at:number|null}>();
  if (existing?.last_event_created_at != null && created > 0 && created < existing.last_event_created_at) return;
  await env.DB.prepare(`INSERT INTO razorpay_unclaimed_subscriptions(subscription_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(subscription_id) DO UPDATE SET razorpay_customer_id=COALESCE(excluded.razorpay_customer_id,razorpay_unclaimed_subscriptions.razorpay_customer_id),plan_id=excluded.plan_id,tier=excluded.tier,status=excluded.status,current_start=COALESCE(excluded.current_start,razorpay_unclaimed_subscriptions.current_start),current_end=COALESCE(excluded.current_end,razorpay_unclaimed_subscriptions.current_end),updated_at=excluded.updated_at,last_event_created_at=excluded.last_event_created_at`).bind(sid, rpc, pid, "pro", status, start ?? null, end ?? null, nowIso(), nowIso(), created > 0 ? created : null).run();
}

async function processEvent(env: Env, eventId: string, event: Event) {
  const eventType = String(event.event ?? "unknown");
  if (!eventType.startsWith("subscription.")) { await markEvent(env, eventId, "ignored"); return; }
  const sub = event.payload?.subscription?.entity;
  if (!sub?.id) throw new Error("Missing subscription entity id");
  const sid = sub.id;
  const planId = String(sub.plan_id ?? "");
  const tier = tierFor(env, planId);
  if (!tier) throw new Error("Unknown Razorpay plan id");
  const eventCreated = Number(event.created_at ?? 0);
  const existing = await env.DB.prepare("SELECT customer_id,is_current,last_event_created_at,status,tier FROM razorpay_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{customer_id:string;is_current:number;last_event_created_at:number|null;status:string;tier:string}>();

  if (!existing) {
    await storeUnclaimed(env, sid, sub.customer_id ? String(sub.customer_id) : null, planId, String(sub.status ?? eventType), sub.current_start, sub.current_end, eventCreated);
    await markEvent(env, eventId, "processed");
    return;
  }

  if (eventCreated > 0 && existing.last_event_created_at != null && eventCreated < existing.last_event_created_at) { await markEvent(env, eventId, "ignored"); return; }
  const active = isActiveEvent(eventType);
  const suspended = isSuspendEvent(eventType);
  const terminal = isTerminalEvent(eventType);
  const current = existing.is_current === 1;
  await env.DB.prepare(`UPDATE razorpay_subscriptions SET plan_id=?,tier=?,status=?,current_start=COALESCE(?,current_start),current_end=COALESCE(?,current_end),updated_at=?,last_event_created_at=?,suspended_at=?,ended_at=?,last_event_id=? WHERE subscription_id=?`).bind(planId, tier, String(sub.status ?? eventType), sub.current_start ?? null, sub.current_end ?? null, nowIso(), eventCreated || null, suspended ? nowIso() : null, terminal ? (sub.ended_at ?? Math.floor(Date.now()/1000)) : null, eventId, sid).run();
  if (current && suspended) await syncCustomer(env, existing.customer_id, false);
  if (current && active) await syncCustomer(env, existing.customer_id, true);
  if (current && terminal) {
    await env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE subscription_id=?").bind(sid).run();
    await env.DB.prepare("UPDATE customers SET tier='free',monthly_quota=(SELECT monthly_quota FROM plans WHERE tier='free' AND active=1),rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier='free' AND active=1),active=1 WHERE id=?").bind(existing.customer_id).run();
  }
  await markEvent(env, eventId, "processed");
}

async function webhook(req: Request, env: Env, id: string) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Razorpay webhook secret is not configured", request_id: id } }, 503, { "x-request-id": id });
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const eventId = req.headers.get("x-razorpay-event-id") ?? "";
  const body = await req.text();
  const expected = await hmac(secret, body);
  if (!signature || !eq(expected, signature)) return json({ error: { code: "INVALID_SIGNATURE", message: "Invalid Razorpay webhook signature", request_id: id } }, 401, { "x-request-id": id });
  if (!eventId) return json({ error: { code: "MISSING_EVENT_ID", message: "Missing x-razorpay-event-id header", request_id: id } }, 400, { "x-request-id": id });
  let event: Event;
  try { event = JSON.parse(body); } catch { return json({ error: { code: "INVALID_JSON", message: "Webhook body must be valid JSON", request_id: id } }, 400, { "x-request-id": id }); }
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const old = await env.DB.prepare("SELECT status,payload_sha256 FROM razorpay_webhook_events WHERE event_id=? LIMIT 1").bind(eventId).first<{status:string;payload_sha256:string}>();
  if (old) {
    if (old.payload_sha256 !== hash) return json({ error: { code: "EVENT_ID_REUSE", message: "Event id reused with different payload", request_id: id } }, 409, { "x-request-id": id });
    if (old.status === "processed" || old.status === "ignored") return json({ status: "ok", duplicate: true, request_id: id }, 200, { "x-request-id": id });
  }
  await env.DB.prepare("INSERT OR IGNORE INTO razorpay_webhook_events(event_id,event_type,status,received_at,payload_sha256) VALUES(?,?,?,?,?)").bind(eventId, String(event.event ?? "unknown"), "received", nowIso(), hash).run();
  try { await processEvent(env, eventId, event); }
  catch (e) { const msg = e instanceof Error ? e.message : "Webhook processing failed"; await markEvent(env, eventId, "failed", msg.slice(0,500)); console.error("Razorpay webhook processing failed", e); return json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: "Webhook processing failed; retry the event", request_id: id } }, 500, { "x-request-id": id }); }
  return json({ status: "processed", request_id: id }, 200, { "x-request-id": id });
}

async function claimSubscription(req: Request, env: Env, id: string) {
  if (!env.API_KEY_PEPPER) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Billing claim is not configured", request_id: id } }, 503, { "x-request-id": id });
  const rawKey = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!rawKey) return json({ error: { code: "UNAUTHORIZED", message: "Valid API key required", request_id: id } }, 401, { "x-request-id": id });
  let body: { subscription_id?: string };
  try { body = await req.json(); } catch { return json({ error: { code: "INVALID_JSON", message: "Request body must be JSON", request_id: id } }, 400, { "x-request-id": id }); }
  const subscriptionId = String(body.subscription_id ?? "").trim();
  if (!subscriptionId) return json({ error: { code: "MISSING_SUBSCRIPTION_ID", message: "subscription_id is required", request_id: id } }, 400, { "x-request-id": id });
  const keyHash = await hashKey(rawKey.trim(), env.API_KEY_PEPPER);
  const customer = await env.DB.prepare("SELECT id,name,tier,active FROM customers c JOIN api_keys k ON k.customer_id=c.id WHERE k.key_hash=? AND k.active=1 LIMIT 1").bind(keyHash).first<{id:string;name:string;tier:string;active:number}>();
  if (!customer) return json({ error: { code: "UNAUTHORIZED", message: "Valid API key required", request_id: id } }, 401, { "x-request-id": id });
  const sub = await env.DB.prepare("SELECT * FROM razorpay_unclaimed_subscriptions WHERE subscription_id=? AND is_claimed=0 LIMIT 1").bind(subscriptionId).first<{subscription_id:string;razorpay_customer_id:string|null;plan_id:string;tier:string;status:string;current_start:number|null;current_end:number|null;last_event_created_at:number|null}>();
  if (!sub) return json({ error: { code: "SUBSCRIPTION_NOT_FOUND", message: "No unclaimed Momentum Pro subscription found for that subscription_id", request_id: id } }, 404, { "x-request-id": id });
  if (isTerminalEvent(`subscription.${sub.status}`) || ["cancelled","completed","expired"].includes(sub.status)) return json({ error: { code: "SUBSCRIPTION_ENDED", message: "The subscription is no longer active", request_id: id } }, 409, { "x-request-id": id });
  const claimedAt = nowIso();
  const updated = await env.DB.prepare("UPDATE razorpay_unclaimed_subscriptions SET is_claimed=1,claimed_customer_id=?,claimed_at=?,updated_at=? WHERE subscription_id=? AND is_claimed=0").bind(customer.id, claimedAt, claimedAt, subscriptionId).run();
  if (updated.meta.changes !== 1) return json({ error: { code: "ALREADY_CLAIMED", message: "Subscription has already been claimed", request_id: id } }, 409, { "x-request-id": id });
  await env.DB.batch([
    env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE customer_id=? AND is_current=1").bind(customer.id),
    env.DB.prepare("INSERT INTO razorpay_subscriptions(subscription_id,customer_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,is_current,suspended_at,ended_at,last_event_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET customer_id=excluded.customer_id,is_current=1,tier=excluded.tier,status=excluded.status,updated_at=excluded.updated_at").bind(sub.subscription_id,customer.id,sub.razorpay_customer_id,sub.plan_id,"pro",sub.status,sub.current_start,sub.current_end,claimedAt,claimedAt,sub.last_event_created_at,1,null,null,null),
  ]);
  const active = !["paused","pending","halted"].includes(sub.status);
  await syncCustomer(env, customer.id, active);
  return json({ status: "activated", customer_id: customer.id, subscription_id: subscriptionId, tier: "pro", active }, 200, { "x-request-id": id });
}

export default {
  async fetch(req: Request, env: Env) {
    const id = requestId();
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (url.pathname === "/health" && req.method === "GET") return json({ status: "ok", service: "momentum-billing" }, 200, { "x-request-id": id });
    if (url.pathname === "/webhooks/razorpay" && req.method === "POST") return webhook(req, env, id);
    if (url.pathname === "/billing/claim" && req.method === "POST") return claimSubscription(req, env, id);
    return json({ error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });
  },
};