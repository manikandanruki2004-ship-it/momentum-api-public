interface Env {
  DB: D1Database;
  API_KEY_PEPPER?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RAZORPAY_TEST_WEBHOOK_SECRET?: string;
  RAZORPAY_PRO_PLAN_ID?: string;
  RAZORPAY_TEST_PRO_PLAN_ID?: string;
}

type Customer = { id: string; name: string; email: string | null; tier: string; active: number };
type Plan = { tier: string; monthly_quota: number; rate_limit_per_minute: number; max_results: number };
type Sub = { id?: string; plan_id?: string; customer_id?: string; status?: string; current_start?: number | null; current_end?: number | null; ended_at?: number | null; notes?: Record<string, string> };
type PaymentEntity = { email?: string | null };
type Event = { event?: string; created_at?: number; payload?: { subscription?: { entity?: Sub }; payment?: { entity?: PaymentEntity } } };
type RazorpayCreateResponse = { id?: string; short_url?: string; status?: string; plan_id?: string; error?: { code?: string; description?: string } };

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const requestId = () => `req_${crypto.randomUUID().replaceAll("-", "")}`;
const nowIso = () => new Date().toISOString();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
}
function eq(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function hashKey(key: string, pepper: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(key)));
}
function proPlanIds(env: Env) { return new Set([env.RAZORPAY_PRO_PLAN_ID, env.RAZORPAY_TEST_PRO_PLAN_ID].filter((x): x is string => Boolean(x))); }
function tierFor(env: Env, planId: string): "pro" | null { return proPlanIds(env).has(planId) ? "pro" : null; }
function activeEvent(e: string) { return e === "subscription.activated" || e === "subscription.resumed" || e === "subscription.charged" || e === "subscription.updated"; }
function suspendEvent(e: string) { return e === "subscription.paused" || e === "subscription.pending" || e === "subscription.halted"; }
function terminalEvent(e: string) { return e === "subscription.cancelled" || e === "subscription.completed" || e === "subscription.expired"; }
function normalizeEmail(value: string | null | undefined) { const e = String(value ?? "").trim().toLowerCase(); return e && e.includes("@") ? e : null; }

async function markEvent(env: Env, eventId: string, status: string, error: string | null = null) {
  await env.DB.prepare("UPDATE razorpay_webhook_events SET status=?,processed_at=?,error_message=? WHERE event_id=?").bind(status, nowIso(), error, eventId).run();
}
async function syncPro(env: Env, customerId: string, active = true) {
  await env.DB.prepare(`UPDATE customers SET tier='pro',monthly_quota=(SELECT monthly_quota FROM plans WHERE tier='pro' AND active=1),rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier='pro' AND active=1),active=? WHERE id=?`).bind(active ? 1 : 0, customerId).run();
}
async function syncFree(env: Env, customerId: string) {
  await env.DB.prepare(`UPDATE customers SET tier='free',monthly_quota=(SELECT monthly_quota FROM plans WHERE tier='free' AND active=1),rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier='free' AND active=1),active=1 WHERE id=?`).bind(customerId).run();
}

async function storeUnclaimed(env: Env, sid: string, rpc: string | null, pid: string, status: string, start: number | null | undefined, end: number | null | undefined, created: number, payerEmail: string | null) {
  const old = await env.DB.prepare("SELECT last_event_created_at FROM razorpay_unclaimed_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{ last_event_created_at: number | null }>();
  if (old?.last_event_created_at != null && created > 0 && created < old.last_event_created_at) return;
  await env.DB.prepare(`INSERT INTO razorpay_unclaimed_subscriptions(subscription_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,payer_email) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET razorpay_customer_id=COALESCE(excluded.razorpay_customer_id,razorpay_unclaimed_subscriptions.razorpay_customer_id),plan_id=excluded.plan_id,tier=excluded.tier,status=excluded.status,current_start=COALESCE(excluded.current_start,razorpay_unclaimed_subscriptions.current_start),current_end=COALESCE(excluded.current_end,razorpay_unclaimed_subscriptions.current_end),updated_at=excluded.updated_at,last_event_created_at=excluded.last_event_created_at,payer_email=COALESCE(excluded.payer_email,razorpay_unclaimed_subscriptions.payer_email)`).bind(sid, rpc, pid, "pro", status, start ?? null, end ?? null, nowIso(), nowIso(), created > 0 ? created : null, payerEmail).run();
}

async function attachSubscription(env: Env, sid: string, customerId: string, status: string, start: number | null | undefined, end: number | null | undefined, created: number, eventId: string, razorpayCustomerId: string | null) {
  const existing = await env.DB.prepare("SELECT customer_id,is_current,last_event_created_at FROM razorpay_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{ customer_id: string; is_current: number; last_event_created_at: number | null }>();
  if (existing && created > 0 && existing.last_event_created_at != null && created < existing.last_event_created_at) return existing.customer_id;
  await env.DB.batch([
    env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE customer_id=? AND is_current=1 AND subscription_id<>?").bind(customerId, sid),
    env.DB.prepare(`INSERT INTO razorpay_subscriptions(subscription_id,customer_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,is_current,suspended_at,ended_at,last_event_id) SELECT ?,?,u.razorpay_customer_id,u.plan_id,'pro',?,?,?,?,COALESCE(u.last_event_created_at,?),1,NULL,NULL,? FROM razorpay_unclaimed_subscriptions u WHERE u.subscription_id=? ON CONFLICT(subscription_id) DO UPDATE SET customer_id=excluded.customer_id,razorpay_customer_id=COALESCE(excluded.razorpay_customer_id,razorpay_subscriptions.razorpay_customer_id),plan_id=excluded.plan_id,tier='pro',status=excluded.status,current_start=COALESCE(excluded.current_start,razorpay_subscriptions.current_start),current_end=COALESCE(excluded.current_end,razorpay_subscriptions.current_end),updated_at=excluded.updated_at,last_event_created_at=COALESCE(excluded.last_event_created_at,razorpay_subscriptions.last_event_created_at),is_current=1,last_event_id=excluded.last_event_id`).bind(sid, customerId, status, start ?? null, end ?? null, nowIso(), nowIso(), created || null, eventId, sid),
  ]);
  await env.DB.prepare("UPDATE razorpay_unclaimed_subscriptions SET is_claimed=1,claimed_customer_id=?,claimed_at=?,updated_at=? WHERE subscription_id=? AND is_claimed=0").bind(customerId, nowIso(), nowIso(), sid).run();
  const active = !suspendEvent(status);
  if (active) await syncPro(env, customerId, true); else await syncPro(env, customerId, false);
  if (razorpayCustomerId) await env.DB.prepare("UPDATE razorpay_subscriptions SET razorpay_customer_id=? WHERE subscription_id=?").bind(razorpayCustomerId, sid).run();
  return customerId;
}

async function autoAttachByEmail(env: Env, sid: string, email: string | null, status: string, start: number | null | undefined, end: number | null | undefined, created: number, eventId: string, razorpayCustomerId: string | null) {
  if (!email) return null;
  const customer = await env.DB.prepare("SELECT id FROM customers WHERE lower(email)=? LIMIT 1").bind(email).first<{ id: string }>();
  if (!customer) return null;
  return attachSubscription(env, sid, customer.id, status, start, end, created, eventId, razorpayCustomerId);
}

async function autoAttachByNote(env: Env, sid: string, customerId: string | null, status: string, start: number | null | undefined, end: number | null | undefined, created: number, eventId: string, razorpayCustomerId: string | null) {
  if (!customerId) return null;
  const customer = await env.DB.prepare("SELECT id FROM customers WHERE id=? LIMIT 1").bind(customerId).first<{ id: string }>();
  if (!customer) return null;
  return attachSubscription(env, sid, customer.id, status, start, end, created, eventId, razorpayCustomerId);
}

async function processEvent(env: Env, eventId: string, event: Event) {
  const et = String(event.event ?? "unknown");
  if (!et.startsWith("subscription.")) { await markEvent(env, eventId, "ignored"); return; }
  const s = event.payload?.subscription?.entity;
  if (!s?.id) throw new Error("Missing subscription entity id");
  const sid = s.id, pid = String(s.plan_id ?? ""), tier = tierFor(env, pid);
  if (!tier) throw new Error("Unknown Razorpay plan id");
  const eventCreated = Number(event.created_at ?? 0);
  const payerEmail = normalizeEmail(event.payload?.payment?.entity?.email);
  const noteCustomerId = typeof s.notes?.momentum_customer_id === "string" ? s.notes.momentum_customer_id : null;
  const existing = await env.DB.prepare("SELECT customer_id,is_current,last_event_created_at,status,tier FROM razorpay_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{ customer_id: string; is_current: number; last_event_created_at: number | null; status: string; tier: string }>();
  if (existing) {
    if (eventCreated > 0 && existing.last_event_created_at != null && eventCreated < existing.last_event_created_at) { await markEvent(env, eventId, "ignored"); return; }
    const current = existing.is_current === 1;
    await env.DB.prepare(`UPDATE razorpay_subscriptions SET plan_id=?,tier=?,status=?,current_start=COALESCE(?,current_start),current_end=COALESCE(?,current_end),updated_at=?,last_event_created_at=?,suspended_at=?,ended_at=?,last_event_id=? WHERE subscription_id=?`).bind(pid, tier, String(s.status ?? et), s.current_start ?? null, s.current_end ?? null, nowIso(), eventCreated || null, suspendEvent(et) ? nowIso() : null, terminalEvent(et) ? (s.ended_at ?? Math.floor(Date.now() / 1000)) : null, eventId, sid).run();
    if (current && suspendEvent(et)) await syncPro(env, existing.customer_id, false);
    if (current && activeEvent(et)) await syncPro(env, existing.customer_id, true);
    if (current && terminalEvent(et)) { await env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE subscription_id=?").bind(sid).run(); await syncFree(env, existing.customer_id); }
    await markEvent(env, eventId, "processed"); return;
  }
  await storeUnclaimed(env, sid, s.customer_id ? String(s.customer_id) : null, pid, String(s.status ?? et), s.current_start, s.current_end, eventCreated, payerEmail);
  const attached = await autoAttachByNote(env, sid, noteCustomerId, String(s.status ?? et), s.current_start, s.current_end, eventCreated, eventId, s.customer_id ? String(s.customer_id) : null)
    ?? await autoAttachByEmail(env, sid, payerEmail, String(s.status ?? et), s.current_start, s.current_end, eventCreated, eventId, s.customer_id ? String(s.customer_id) : null);
  if (attached && s.customer_id) await env.DB.prepare("UPDATE razorpay_subscriptions SET razorpay_customer_id=COALESCE(razorpay_customer_id,?) WHERE subscription_id=?").bind(String(s.customer_id), sid).run();
  await markEvent(env, eventId, "processed");
}

async function webhook(req: Request, env: Env, id: string) {
  const secrets = [env.RAZORPAY_WEBHOOK_SECRET, env.RAZORPAY_TEST_WEBHOOK_SECRET].filter((x): x is string => Boolean(x));
  if (!secrets.length) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Razorpay webhook secret is not configured", request_id: id } }, 503, { "x-request-id": id });
  const signature = req.headers.get("x-razorpay-signature") ?? "", eventId = req.headers.get("x-razorpay-event-id") ?? "", body = await req.text();
  if (!signature) return json({ error: { code: "INVALID_SIGNATURE", message: "Invalid Razorpay webhook signature", request_id: id } }, 401, { "x-request-id": id });
  let verified = false; for (const secret of secrets) { if (eq(await hmac(secret, body), signature)) { verified = true; break; } }
  if (!verified) return json({ error: { code: "INVALID_SIGNATURE", message: "Invalid Razorpay webhook signature", request_id: id } }, 401, { "x-request-id": id });
  if (!eventId) return json({ error: { code: "MISSING_EVENT_ID", message: "Missing x-razorpay-event-id header", request_id: id } }, 400, { "x-request-id": id });
  let event: Event; try { event = JSON.parse(body); } catch { return json({ error: { code: "INVALID_JSON", message: "Webhook body must be valid JSON", request_id: id } }, 400, { "x-request-id": id }); }
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const old = await env.DB.prepare("SELECT status,payload_sha256 FROM razorpay_webhook_events WHERE event_id=? LIMIT 1").bind(eventId).first<{ status: string; payload_sha256: string }>();
  if (old) { if (old.payload_sha256 !== hash) return json({ error: { code: "EVENT_ID_REUSE", message: "Event id reused with different payload", request_id: id } }, 409, { "x-request-id": id }); if (old.status === "processed" || old.status === "ignored") return json({ status: "ok", duplicate: true, request_id: id }, 200, { "x-request-id": id }); }
  await env.DB.prepare("INSERT OR IGNORE INTO razorpay_webhook_events(event_id,event_type,status,received_at,payload_sha256) VALUES(?,?,?,?,?)").bind(eventId, String(event.event ?? "unknown"), "received", nowIso(), hash).run();
  try { await processEvent(env, eventId, event); } catch (e) { const msg = e instanceof Error ? e.message : "Webhook processing failed"; await markEvent(env, eventId, "failed", msg.slice(0, 500)); console.error("Razorpay webhook processing failed", e); return json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: "Webhook processing failed; retry the event", request_id: id } }, 500, { "x-request-id": id }); }
  return json({ status: "processed", request_id: id }, 200, { "x-request-id": id });
}

async function getSessionCustomer(req: Request, env: Env): Promise<Customer | null> {
  if (!env.API_KEY_PEPPER) return null;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim(); if (!token) return null;
  const h = await hashKey(token, env.API_KEY_PEPPER);
  return env.DB.prepare(`SELECT c.id,c.name,c.email,c.tier,c.active FROM auth_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.session_id_hash=? AND s.expires_at>? LIMIT 1`).bind(h, nowIso()).first<Customer>();
}

async function createCheckout(req: Request, env: Env, id: string) {
  const customer = await getSessionCustomer(req, env);
  if (!customer) return json({ error: { code: "UNAUTHORIZED", message: "Valid Momentum session required", request_id: id } }, 401, { "x-request-id": id });
  if (!customer.active) return json({ error: { code: "SUBSCRIPTION_SUSPENDED", message: "Your Momentum subscription is suspended", request_id: id } }, 403, { "x-request-id": id });
  if (customer.tier === "pro") return json({ error: { code: "ALREADY_PRO", message: "This account already has Pro access", request_id: id } }, 409, { "x-request-id": id });
  const keyId = env.RAZORPAY_KEY_ID, keySecret = env.RAZORPAY_KEY_SECRET, planId = env.RAZORPAY_PRO_PLAN_ID;
  if (!keyId || !keySecret || !planId) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Razorpay Pro checkout is not configured", request_id: id } }, 503, { "x-request-id": id });
  const auth = btoa(`${keyId}:${keySecret}`);
  const payload = { plan_id: planId, total_count: 12, quantity: 1, customer_notify: false, notes: { momentum_customer_id: customer.id, momentum_tier: "pro", source: "momentum-web" } };
  let response: Response;
  try { response = await fetch("https://api.razorpay.com/v1/subscriptions", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) }); } catch { return json({ error: { code: "RAZORPAY_UNAVAILABLE", message: "Razorpay could not be reached", request_id: id } }, 502, { "x-request-id": id }); }
  const data = await response.json<RazorpayCreateResponse>();
  if (!response.ok || !data.short_url) { console.error("Razorpay subscription creation failed", data.error?.code, data.error?.description); return json({ error: { code: "RAZORPAY_CREATE_FAILED", message: "Razorpay could not create the Pro checkout", request_id: id } }, 502, { "x-request-id": id }); }
  return json({ status: "created", subscription_id: data.id, checkout_url: data.short_url }, 200, { "x-request-id": id, "cache-control": "no-store" });
}

async function claimSubscription(req: Request, env: Env, id: string) {
  const customer = await getSessionCustomer(req, env);
  if (!customer || !customer.active) return json({ error: { code: "UNAUTHORIZED", message: "Valid active Momentum session required", request_id: id } }, 401, { "x-request-id": id });
  const email = normalizeEmail(customer.email); const planIds = proPlanIds(env);
  if (!email) return json({ error: { code: "ACCOUNT_EMAIL_REQUIRED", message: "A verified Google email is required", request_id: id } }, 400, { "x-request-id": id });
  if (!planIds.size) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "No Razorpay Pro plan is configured", request_id: id } }, 503, { "x-request-id": id });
  const placeholders = [...planIds].map(() => "?").join(",");
  const sub = await env.DB.prepare(`SELECT * FROM razorpay_unclaimed_subscriptions WHERE is_claimed=0 AND lower(payer_email)=? AND plan_id IN (${placeholders}) ORDER BY COALESCE(last_event_created_at,0) DESC,updated_at DESC LIMIT 1`).bind(email, ...planIds).first<{ subscription_id: string; razorpay_customer_id: string | null; plan_id: string; tier: string; status: string; current_start: number | null; current_end: number | null; last_event_created_at: number | null }>();
  if (!sub) return json({ error: { code: "NO_PENDING_SUBSCRIPTION", message: "No pending Momentum Pro subscription found for this Google account", request_id: id } }, 404, { "x-request-id": id });
  const changed = await env.DB.prepare("UPDATE razorpay_unclaimed_subscriptions SET is_claimed=1,claimed_customer_id=?,claimed_at=?,updated_at=? WHERE subscription_id=? AND is_claimed=0").bind(customer.id, nowIso(), nowIso(), sub.subscription_id).run();
  if (changed.meta.changes !== 1) return json({ error: { code: "ALREADY_CLAIMED", message: "Subscription has already been claimed", request_id: id } }, 409, { "x-request-id": id });
  await env.DB.batch([env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE customer_id=? AND is_current=1").bind(customer.id), env.DB.prepare("INSERT INTO razorpay_subscriptions(subscription_id,customer_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,is_current,suspended_at,ended_at,last_event_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET customer_id=excluded.customer_id,is_current=1,tier='pro',status=excluded.status,updated_at=excluded.updated_at").bind(sub.subscription_id, customer.id, sub.razorpay_customer_id, sub.plan_id, "pro", sub.status, sub.current_start, sub.current_end, nowIso(), nowIso(), sub.last_event_created_at, 1, null, null, null)]);
  const active = !suspendEvent(`subscription.${sub.status}`); if (active) await syncPro(env, customer.id, true); else await syncPro(env, customer.id, false);
  return json({ status: "activated", customer_id: customer.id, subscription_id: sub.subscription_id, tier: "pro", active }, 200, { "x-request-id": id });
}

export default {
  async fetch(req: Request, env: Env) {
    const id = requestId(), u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (u.pathname === "/health" && req.method === "GET") return json({ status: "ok", service: "momentum-billing" }, 200, { "x-request-id": id });
    if (u.pathname === "/webhooks/razorpay" && req.method === "POST") return webhook(req, env, id);
    if (u.pathname === "/billing/checkout" && req.method === "POST") return createCheckout(req, env, id);
    if (u.pathname === "/billing/claim" && req.method === "POST") return claimSubscription(req, env, id);
    return json({ error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });
  },
};
