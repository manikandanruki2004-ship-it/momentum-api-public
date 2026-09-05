import { RazorpayProvider, type RazorpaySubscriptionResponse } from "./provider";

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
type Sub = { id?: string; plan_id?: string; customer_id?: string; status?: string; current_start?: number | null; current_end?: number | null; ended_at?: number | null; notes?: Record<string, string> };
type PaymentEntity = { email?: string | null };
type Event = { event?: string; created_at?: number; payload?: { subscription?: { entity?: Sub }; payment?: { entity?: PaymentEntity } } };

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const requestId = () => `req_${crypto.randomUUID().replaceAll("-", "")}`;
const nowIso = () => new Date().toISOString();
const laterIso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
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
function isActiveEvent(event: string, status: string) { return event === "subscription.activated" || event === "subscription.resumed" || event === "subscription.charged" || (event === "subscription.updated" && status === "active"); }
function isSuspendEvent(event: string) { return event === "subscription.paused" || event === "subscription.pending" || event === "subscription.halted"; }
function isTerminalEvent(event: string) { return event === "subscription.cancelled" || event === "subscription.completed" || event === "subscription.expired"; }
function normalizeEmail(value: string | null | undefined) { const e = String(value ?? "").trim().toLowerCase(); return e && e.includes("@") ? e : null; }

async function markEvent(env: Env, eventId: string, status: string, error: string | null = null) {
  await env.DB.prepare("UPDATE razorpay_webhook_events SET status=?,processed_at=?,error_message=? WHERE event_id=?").bind(status, nowIso(), error, eventId).run();
}
async function syncPro(env: Env, customerId: string, active: boolean) {
  await env.DB.prepare(`UPDATE customers SET tier='pro',monthly_quota=(SELECT monthly_quota FROM plans WHERE tier='pro' AND active=1),rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier='pro' AND active=1),active=? WHERE id=?`).bind(active ? 1 : 0, customerId).run();
}
async function syncFree(env: Env, customerId: string) {
  await env.DB.prepare(`UPDATE customers SET tier='free',monthly_quota=(SELECT monthly_quota FROM plans WHERE tier='free' AND active=1),rate_limit_per_minute=(SELECT rate_limit_per_minute FROM plans WHERE tier='free' AND active=1),active=1 WHERE id=?`).bind(customerId).run();
}

async function storeUnclaimed(env: Env, sid: string, rpc: string | null, pid: string, status: string, start: number | null | undefined, end: number | null | undefined, created: number, payerEmail: string | null) {
  const old = await env.DB.prepare("SELECT last_event_created_at FROM razorpay_unclaimed_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{ last_event_created_at: number | null }>();
  if (old?.last_event_created_at != null && created > 0 && created < old.last_event_created_at) return;
  await env.DB.prepare(`INSERT INTO razorpay_unclaimed_subscriptions(subscription_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,payer_email) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET razorpay_customer_id=COALESCE(excluded.razorpay_customer_id,razorpay_unclaimed_subscriptions.razorpay_customer_id),plan_id=excluded.plan_id,tier='pro',status=excluded.status,current_start=COALESCE(excluded.current_start,razorpay_unclaimed_subscriptions.current_start),current_end=COALESCE(excluded.current_end,razorpay_unclaimed_subscriptions.current_end),updated_at=excluded.updated_at,last_event_created_at=excluded.last_event_created_at,payer_email=COALESCE(excluded.payer_email,razorpay_unclaimed_subscriptions.payer_email)`).bind(sid, rpc, pid, status, start ?? null, end ?? null, nowIso(), nowIso(), created > 0 ? created : null, payerEmail).run();
}

async function attachSubscription(env: Env, sid: string, customerId: string, status: string, start: number | null | undefined, end: number | null | undefined, created: number, eventId: string, razorpayCustomerId: string | null, grantAccess: boolean) {
  const existing = await env.DB.prepare("SELECT customer_id,is_current,last_event_created_at FROM razorpay_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{ customer_id: string; is_current: number; last_event_created_at: number | null }>();
  if (existing && created > 0 && existing.last_event_created_at != null && created < existing.last_event_created_at) return existing.customer_id;
  await env.DB.batch([
    env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE customer_id=? AND is_current=1 AND subscription_id<>?").bind(customerId, sid),
    env.DB.prepare(`INSERT INTO razorpay_subscriptions(subscription_id,customer_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,is_current,suspended_at,ended_at,last_event_id) SELECT ?,?,u.razorpay_customer_id,u.plan_id,'pro',?,?,?,?,COALESCE(u.last_event_created_at,?),1,?,?,? FROM razorpay_unclaimed_subscriptions u WHERE u.subscription_id=? ON CONFLICT(subscription_id) DO UPDATE SET customer_id=excluded.customer_id,razorpay_customer_id=COALESCE(excluded.razorpay_customer_id,razorpay_subscriptions.razorpay_customer_id),plan_id=excluded.plan_id,tier='pro',status=excluded.status,current_start=COALESCE(excluded.current_start,razorpay_subscriptions.current_start),current_end=COALESCE(excluded.current_end,razorpay_subscriptions.current_end),updated_at=excluded.updated_at,last_event_created_at=COALESCE(excluded.last_event_created_at,razorpay_subscriptions.last_event_created_at),is_current=1,suspended_at=excluded.suspended_at,ended_at=excluded.ended_at,last_event_id=excluded.last_event_id`).bind(sid, customerId, status, start ?? null, end ?? null, nowIso(), nowIso(), created || null, grantAccess ? null : nowIso(), null, eventId, sid),
  ]);
  await env.DB.prepare("UPDATE razorpay_unclaimed_subscriptions SET is_claimed=1,claimed_customer_id=?,claimed_at=?,updated_at=? WHERE subscription_id=? AND is_claimed=0").bind(customerId, nowIso(), nowIso(), sid).run();
  if (grantAccess) await syncPro(env, customerId, true);
  if (razorpayCustomerId) await env.DB.prepare("UPDATE razorpay_subscriptions SET razorpay_customer_id=? WHERE subscription_id=?").bind(razorpayCustomerId, sid).run();
  return customerId;
}

async function processEvent(env: Env, eventId: string, event: Event) {
  const et = String(event.event ?? "unknown");
  if (!et.startsWith("subscription.")) { await markEvent(env, eventId, "ignored"); return; }
  const s = event.payload?.subscription?.entity;
  if (!s?.id) throw new Error("Missing subscription entity id");
  const sid = s.id, pid = String(s.plan_id ?? ""), tier = tierFor(env, pid);
  if (!tier) throw new Error("Unknown Razorpay plan id");
  const eventCreated = Number(event.created_at ?? 0);
  const status = String(s.status ?? et);
  const payerEmail = normalizeEmail(event.payload?.payment?.entity?.email);
  const noteCustomerId = typeof s.notes?.momentum_customer_id === "string" ? s.notes.momentum_customer_id : null;
  const existing = await env.DB.prepare("SELECT customer_id,is_current,last_event_created_at,status,tier FROM razorpay_subscriptions WHERE subscription_id=? LIMIT 1").bind(sid).first<{ customer_id: string; is_current: number; last_event_created_at: number | null; status: string; tier: string }>();
  if (existing) {
    if (eventCreated > 0 && existing.last_event_created_at != null && eventCreated < existing.last_event_created_at) { await markEvent(env, eventId, "ignored"); return; }
    const current = existing.is_current === 1;
    await env.DB.prepare(`UPDATE razorpay_subscriptions SET plan_id=?,tier=?,status=?,current_start=COALESCE(?,current_start),current_end=COALESCE(?,current_end),updated_at=?,last_event_created_at=?,suspended_at=?,ended_at=?,last_event_id=? WHERE subscription_id=?`).bind(pid, tier, status, s.current_start ?? null, s.current_end ?? null, nowIso(), eventCreated || null, isSuspendEvent(et) ? nowIso() : null, isTerminalEvent(et) ? (s.ended_at ?? Math.floor(Date.now() / 1000)) : null, eventId, sid).run();
    if (current && isSuspendEvent(et)) await syncPro(env, existing.customer_id, false);
    if (current && isActiveEvent(et, status)) await syncPro(env, existing.customer_id, true);
    if (current && isTerminalEvent(et)) { await env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE subscription_id=?").bind(sid).run(); await syncFree(env, existing.customer_id); }
    await markEvent(env, eventId, "processed"); return;
  }
  await storeUnclaimed(env, sid, s.customer_id ? String(s.customer_id) : null, pid, status, s.current_start, s.current_end, eventCreated, payerEmail);
  const grant = isActiveEvent(et, status);
  let attached: string | null = null;
  if (noteCustomerId) {
    const customer = await env.DB.prepare("SELECT id FROM customers WHERE id=? LIMIT 1").bind(noteCustomerId).first<{ id: string }>();
    if (customer) attached = await attachSubscription(env, sid, customer.id, status, s.current_start, s.current_end, eventCreated, eventId, s.customer_id ? String(s.customer_id) : null, grant);
  }
  if (!attached && payerEmail) {
    const customer = await env.DB.prepare("SELECT id FROM customers WHERE lower(email)=? LIMIT 1").bind(payerEmail).first<{ id: string }>();
    if (customer) attached = await attachSubscription(env, sid, customer.id, status, s.current_start, s.current_end, eventCreated, eventId, s.customer_id ? String(s.customer_id) : null, grant);
  }
  await markEvent(env, eventId, "processed");
}

async function webhook(req: Request, env: Env, id: string) {
  const secrets = [env.RAZORPAY_WEBHOOK_SECRET, env.RAZORPAY_TEST_WEBHOOK_SECRET].filter((x): x is string => Boolean(x));
  if (!secrets.length) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Razorpay webhook secret is not configured", request_id: id } }, 503);
  const signature = req.headers.get("x-razorpay-signature") ?? "", eventId = req.headers.get("x-razorpay-event-id") ?? "", body = await req.text();
  if (!signature) return json({ error: { code: "INVALID_SIGNATURE", message: "Invalid Razorpay webhook signature", request_id: id } }, 401);
  let verified = false; for (const secret of secrets) { if (eq(await hmac(secret, body), signature)) { verified = true; break; } }
  if (!verified) return json({ error: { code: "INVALID_SIGNATURE", message: "Invalid Razorpay webhook signature", request_id: id } }, 401);
  if (!eventId) return json({ error: { code: "MISSING_EVENT_ID", message: "Missing x-razorpay-event-id header", request_id: id } }, 400);
  let event: Event; try { event = JSON.parse(body); } catch { return json({ error: { code: "INVALID_JSON", message: "Webhook body must be valid JSON", request_id: id } }, 400); }
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const old = await env.DB.prepare("SELECT status,payload_sha256 FROM razorpay_webhook_events WHERE event_id=? LIMIT 1").bind(eventId).first<{ status: string; payload_sha256: string }>();
  if (old) { if (old.payload_sha256 !== hash) return json({ error: { code: "EVENT_ID_REUSE", message: "Event id reused with different payload", request_id: id } }, 409); if (old.status === "processed" || old.status === "ignored") return json({ status: "ok", duplicate: true, request_id: id }); }
  await env.DB.prepare("INSERT OR IGNORE INTO razorpay_webhook_events(event_id,event_type,status,received_at,payload_sha256) VALUES(?,?,?,?,?)").bind(eventId, String(event.event ?? "unknown"), "received", nowIso(), hash).run();
  try { await processEvent(env, eventId, event); } catch (e) { const msg = e instanceof Error ? e.message : "Webhook processing failed"; await markEvent(env, eventId, "failed", msg.slice(0, 500)); console.error("Razorpay webhook processing failed", { request_id: id, event_id: eventId, error: msg }); return json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: "Webhook processing failed; retry the event", request_id: id } }, 500); }
  return json({ status: "processed", request_id: id });
}

async function getSessionCustomer(req: Request, env: Env): Promise<Customer | null> {
  if (!env.API_KEY_PEPPER) return null;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const h = await hashKey(token, env.API_KEY_PEPPER);
  return env.DB.prepare(`SELECT c.id,c.name,c.email,c.tier,c.active FROM auth_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.session_id_hash=? AND s.expires_at>? LIMIT 1`).bind(h, nowIso()).first<Customer>();
}

async function acquireCheckoutLease(env: Env, customerId: string) {
  const current = await env.DB.prepare("SELECT status,subscription_id,checkout_url,expires_at FROM razorpay_checkout_attempts WHERE customer_id=? LIMIT 1").bind(customerId).first<{ status: string; subscription_id: string | null; checkout_url: string | null; expires_at: string }>();
  const now = nowIso();
  if (current && current.expires_at > now) {
    if (current.status === "created" && current.checkout_url) return { acquired: false, existingUrl: current.checkout_url };
    if (current.status === "creating") return { acquired: false, inProgress: true };
  }
  const created = nowIso(), expires = laterIso(10);
  const result = await env.DB.prepare(`INSERT INTO razorpay_checkout_attempts(customer_id,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET subscription_id=NULL,checkout_url=NULL,status='creating',updated_at=excluded.updated_at,expires_at=excluded.expires_at WHERE razorpay_checkout_attempts.expires_at<=? OR razorpay_checkout_attempts.status='failed'`).bind(customerId, "creating", created, created, expires, now).run();
  if (result.meta.changes !== 1) return { acquired: false, inProgress: true };
  return { acquired: true };
}

async function saveCheckoutLease(env: Env, customerId: string, subscriptionId: string, checkoutUrl: string) {
  await env.DB.prepare("UPDATE razorpay_checkout_attempts SET status='created',subscription_id=?,checkout_url=?,updated_at=?,expires_at=? WHERE customer_id=? AND status='creating'").bind(subscriptionId, checkoutUrl, nowIso(), laterIso(30), customerId).run();
}
async function failCheckoutLease(env: Env, customerId: string) {
  await env.DB.prepare("UPDATE razorpay_checkout_attempts SET status='failed',updated_at=?,expires_at=? WHERE customer_id=? AND status='creating'").bind(nowIso(), nowIso(), customerId).run();
}

async function createCustomerSubscription(req: Request, env: Env, id: string) {
  const customer = await getSessionCustomer(req, env);
  if (!customer || !customer.active) return json({ error: { code: "UNAUTHORIZED", message: "Valid active Momentum session required", request_id: id } }, 401, { "x-request-id": id });
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_PRO_PLAN_ID) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Razorpay checkout is not configured", request_id: id } }, 503, { "x-request-id": id });
  if (customer.tier === "pro") return json({ error: { code: "ALREADY_PRO", message: "This account already has Pro access", request_id: id } }, 409, { "x-request-id": id });
  const existing = await env.DB.prepare(`SELECT subscription_id,status,is_current FROM razorpay_subscriptions WHERE customer_id=? AND is_current=1 ORDER BY updated_at DESC LIMIT 1`).bind(customer.id).first<{ subscription_id: string; status: string; is_current: number }>();
  if (existing && ["created","authenticated","active","pending","halted","paused"].includes(existing.status)) return json({ error: { code: "SUBSCRIPTION_EXISTS", message: "A Momentum subscription already exists for this account", request_id: id } }, 409, { "x-request-id": id });

  const lease = await acquireCheckoutLease(env, customer.id);
  if (lease.existingUrl) return json({ status: "created", checkout_url: lease.existingUrl, reused: true }, 200, { "x-request-id": id, "cache-control": "no-store" });
  if (lease.inProgress) return json({ error: { code: "CHECKOUT_IN_PROGRESS", message: "A Pro checkout is already being prepared for this account", request_id: id } }, 409, { "x-request-id": id, "retry-after": "5" });

  const payload = {
    plan_id: env.RAZORPAY_PRO_PLAN_ID,
    total_count: 12,
    quantity: 1,
    customer_notify: false,
    notes: { momentum_customer_id: customer.id, momentum_tier: "pro", momentum_product: "momentum-api" },
  };
  try {
    const provider = new RazorpayProvider(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, 8000);
    const result = await provider.createSubscription(payload);
    const data: RazorpaySubscriptionResponse = result.data;
    if (!result.ok || !data.id || !data.short_url) {
      await failCheckoutLease(env, customer.id);
      const detail = data?.error?.description || data?.error?.code || (result.status >= 500 ? "Razorpay is temporarily unavailable" : "Razorpay subscription creation failed");
      return json({ error: { code: "RAZORPAY_CREATE_FAILED", message: detail, request_id: id } }, result.status >= 400 && result.status < 500 ? result.status : 502, { "x-request-id": id });
    }
    await saveCheckoutLease(env, customer.id, data.id, data.short_url);
    try {
      await storeUnclaimed(env, data.id, null, env.RAZORPAY_PRO_PLAN_ID, "created", null, null, Math.floor(Date.now() / 1000), normalizeEmail(customer.email));
    } catch (persistError) {
      console.error("billing checkout persistence failed", { request_id: id, subscription_id: data.id, customer_id: customer.id, error: persistError instanceof Error ? persistError.message : String(persistError) });
    }
    return json({ status: "created", subscription_id: data.id, checkout_url: data.short_url }, 201, { "x-request-id": id, "cache-control": "no-store" });
  } catch (error) {
    await failCheckoutLease(env, customer.id);
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.error("Razorpay checkout provider failure", { request_id: id, customer_id: customer.id, timeout: timedOut, error: error instanceof Error ? error.message : String(error) });
    return json({ error: { code: timedOut ? "RAZORPAY_TIMEOUT" : "RAZORPAY_UNAVAILABLE", message: timedOut ? "Razorpay checkout timed out. Please try again." : "Razorpay checkout is temporarily unavailable. Please try again.", request_id: id } }, 504, { "x-request-id": id, "retry-after": "5" });
  }
}

async function refreshSubscription(req: Request, env: Env, id: string) {
  const customer = await getSessionCustomer(req, env);
  if (!customer || !customer.active) return json({ error: { code: "UNAUTHORIZED", message: "Valid active Momentum session required", request_id: id } }, 401, { "x-request-id": id });
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Razorpay status refresh is not configured", request_id: id } }, 503, { "x-request-id": id });

  let sid: string | null = null;
  const local = await env.DB.prepare("SELECT subscription_id FROM razorpay_subscriptions WHERE customer_id=? ORDER BY is_current DESC,updated_at DESC LIMIT 1").bind(customer.id).first<{ subscription_id: string }>();
  if (local?.subscription_id) sid = local.subscription_id;
  if (!sid) {
    const attempt = await env.DB.prepare("SELECT subscription_id FROM razorpay_checkout_attempts WHERE customer_id=? AND status='created' AND subscription_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(customer.id).first<{ subscription_id: string }>();
    sid = attempt?.subscription_id ?? null;
  }
  if (!sid) return json({ status: "not_found", tier: customer.tier, active: Number(customer.active) === 1, request_id: id }, 200, { "x-request-id": id, "cache-control": "no-store" });

  try {
    const provider = new RazorpayProvider(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, 8000);
    const result = await provider.getSubscription(sid);
    const data = result.data;
    if (!result.ok || !data.id) {
      const retryable = result.status >= 500 || result.status === 429;
      console.error("Razorpay subscription refresh failed", { request_id: id, customer_id: customer.id, subscription_id: sid, status: result.status });
      return json({ error: { code: retryable ? "RAZORPAY_STATUS_UNAVAILABLE" : "RAZORPAY_STATUS_FAILED", message: retryable ? "Razorpay status is temporarily unavailable. Try again shortly." : "Razorpay could not return this subscription.", request_id: id } }, retryable ? 504 : 502, { "x-request-id": id, ...(retryable ? { "retry-after": "5" } : {}) });
    }

    const planId = String(data.plan_id ?? "");
    if (!tierFor(env, planId)) return json({ error: { code: "UNKNOWN_PLAN", message: "Subscription is not a recognized Momentum Pro plan", request_id: id } }, 409, { "x-request-id": id });
    const status = String(data.status ?? "unknown");
    const active = status === "active";
    const suspended = ["pending", "halted", "paused"].includes(status);
    const terminal = ["cancelled", "completed", "expired"].includes(status);
    const customerId = customer.id;
    const rpc = data.customer_id ? String(data.customer_id) : null;
    const stamp = Math.floor(Date.now() / 1000);

    if (active) {
      await storeUnclaimed(env, sid, rpc, planId, status, data.current_start, data.current_end, stamp, normalizeEmail(customer.email));
      await attachSubscription(env, sid, customerId, status, data.current_start, data.current_end, stamp, `status_${crypto.randomUUID()}`, rpc, true);
    } else if (terminal) {
      await env.DB.prepare(`UPDATE razorpay_subscriptions SET status=?,razorpay_customer_id=COALESCE(?,razorpay_customer_id),current_start=COALESCE(?,current_start),current_end=COALESCE(?,current_end),ended_at=COALESCE(ended_at,?),updated_at=?,is_current=0 WHERE subscription_id=? AND customer_id=?`).bind(status, rpc, data.current_start ?? null, data.current_end ?? null, data.ended_at ?? stamp, nowIso(), sid, customerId).run();
      await syncFree(env, customerId);
    } else if (suspended) {
      await env.DB.prepare(`UPDATE razorpay_subscriptions SET status=?,razorpay_customer_id=COALESCE(?,razorpay_customer_id),current_start=COALESCE(?,current_start),current_end=COALESCE(?,current_end),suspended_at=COALESCE(suspended_at,?),updated_at=? WHERE subscription_id=? AND customer_id=?`).bind(status, rpc, data.current_start ?? null, data.current_end ?? null, stamp, nowIso(), sid, customerId).run();
      if (customer.tier === "pro") await syncPro(env, customerId, false);
    } else {
      await storeUnclaimed(env, sid, rpc, planId, status, data.current_start, data.current_end, stamp, normalizeEmail(customer.email));
    }

    const refreshed = await env.DB.prepare("SELECT tier,active FROM customers WHERE id=? LIMIT 1").bind(customerId).first<{ tier: string; active: number }>();
    return json({ status, subscription_id: sid, razorpay_customer_id: rpc, tier: refreshed?.tier ?? customer.tier, active: Number(refreshed?.active ?? customer.active) === 1, synchronized: active || suspended || terminal, request_id: id }, 200, { "x-request-id": id, "cache-control": "no-store" });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.error("Razorpay subscription refresh provider failure", { request_id: id, customer_id: customer.id, subscription_id: sid, timeout: timedOut, error: error instanceof Error ? error.message : String(error) });
    return json({ error: { code: timedOut ? "RAZORPAY_TIMEOUT" : "RAZORPAY_UNAVAILABLE", message: timedOut ? "Razorpay status refresh timed out. Please try again." : "Razorpay status refresh is temporarily unavailable. Please try again.", request_id: id } }, 504, { "x-request-id": id, "retry-after": "5" });
  }
}

async function claimSubscription(req: Request, env: Env, id: string) {
  const customer = await getSessionCustomer(req, env);
  if (!customer || !customer.active) return json({ error: { code: "UNAUTHORIZED", message: "Valid active Momentum session required", request_id: id } }, 401, { "x-request-id": id });
  const email = normalizeEmail(customer.email);
  if (!email) return json({ error: { code: "ACCOUNT_EMAIL_REQUIRED", message: "A verified Google email is required", request_id: id } }, 400, { "x-request-id": id });
  const planIds = proPlanIds(env); if (!planIds.size) return json({ error: { code: "BILLING_NOT_CONFIGURED", message: "No Razorpay Pro plan is configured", request_id: id } }, 503, { "x-request-id": id });
  const placeholders = [...planIds].map(() => "?").join(",");
  const sub = await env.DB.prepare(`SELECT * FROM razorpay_unclaimed_subscriptions WHERE is_claimed=0 AND lower(payer_email)=? AND plan_id IN (${placeholders}) ORDER BY COALESCE(last_event_created_at,0) DESC,updated_at DESC LIMIT 1`).bind(email, ...planIds).first<{ subscription_id: string; razorpay_customer_id: string | null; plan_id: string; tier: string; status: string; current_start: number | null; current_end: number | null; last_event_created_at: number | null }>();
  if (!sub) return json({ error: { code: "NO_PENDING_SUBSCRIPTION", message: "No pending Momentum Pro subscription found for this Google account", request_id: id } }, 404, { "x-request-id": id });
  const updated = await env.DB.prepare("UPDATE razorpay_unclaimed_subscriptions SET is_claimed=1,claimed_customer_id=?,claimed_at=?,updated_at=? WHERE subscription_id=? AND is_claimed=0").bind(customer.id, nowIso(), nowIso(), sub.subscription_id).run();
  if (updated.meta.changes !== 1) return json({ error: { code: "ALREADY_CLAIMED", message: "Subscription has already been claimed", request_id: id } }, 409, { "x-request-id": id });
  const grant = sub.status === "active";
  await env.DB.batch([
    env.DB.prepare("UPDATE razorpay_subscriptions SET is_current=0 WHERE customer_id=? AND is_current=1").bind(customer.id),
    env.DB.prepare("INSERT INTO razorpay_subscriptions(subscription_id,customer_id,razorpay_customer_id,plan_id,tier,status,current_start,current_end,created_at,updated_at,last_event_created_at,is_current,suspended_at,ended_at,last_event_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET customer_id=excluded.customer_id,is_current=1,tier='pro',status=excluded.status,updated_at=excluded.updated_at,last_event_created_at=excluded.last_event_created_at").bind(sub.subscription_id, customer.id, sub.razorpay_customer_id, sub.plan_id, "pro", sub.status, sub.current_start, sub.current_end, nowIso(), nowIso(), sub.last_event_created_at, 1, null, null, null),
  ]);
  if (grant) await syncPro(env, customer.id, true);
  return json({ status: grant ? "activated" : "linked", customer_id: customer.id, subscription_id: sub.subscription_id, tier: "pro", active: grant }, 200, { "x-request-id": id });
}

export default {
  async fetch(req: Request, env: Env) {
    const id = requestId(), u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (u.pathname === "/health" && req.method === "GET") return json({ status: "ok", service: "momentum-billing", release: "checkout-status-v1" }, 200, { "x-request-id": id });
    if (u.pathname === "/billing/checkout" && req.method === "POST") return createCustomerSubscription(req, env, id);
    if (u.pathname === "/billing/status" && req.method === "GET") return refreshSubscription(req, env, id);
    if (u.pathname === "/billing/claim" && req.method === "POST") return claimSubscription(req, env, id);
    if (u.pathname === "/webhooks/razorpay" && req.method === "POST") return webhook(req, env, id);
    return json({ error: { code: "NOT_FOUND", message: "Route not found", request_id: id } }, 404, { "x-request-id": id });
  },
};
