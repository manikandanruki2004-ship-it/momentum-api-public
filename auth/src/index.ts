interface Env {
  DB: D1Database;
  API_KEY_PEPPER: string;
  GOOGLE_CLIENT_ID: string;
}

type GoogleClaims = {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  exp?: number;
};

type Plan = { tier: string; monthly_quota: number; rate_limit_per_minute: number; max_results: number };

type Customer = { id: string; name: string; email: string | null; tier: string; monthly_quota: number; rate_limit_per_minute: number; active: number };

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

const nowIso = () => new Date().toISOString();
const monthKey = () => new Date().toISOString().slice(0, 7);
const requestId = () => `req_${crypto.randomUUID().replaceAll("-", "")}`;

function error(code: string, message: string, id: string, status: number) {
  return json({ error: { code, message, request_id: id } }, status, { "x-request-id": id });
}

function base64urlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function importJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

let jwksCache: { keys: JsonWebKey[]; expiresAt: number } | null = null;

async function googleKeys(): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Google signing keys unavailable");
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] ?? 3600);
  const body = await response.json<{ keys?: JsonWebKey[] }>();
  const keys = body.keys ?? [];
  jwksCache = { keys, expiresAt: Date.now() + Math.min(Math.max(maxAge, 300), 86400) * 1000 };
  return keys;
}

async function verifyGoogleIdToken(token: string, clientId: string): Promise<GoogleClaims> {
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new Error("Invalid Google ID token");
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(pieces[0])) as string) as { alg?: string; kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(pieces[1])) as string) as GoogleClaims;
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported Google ID token");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("Invalid Google token issuer");
  if (claims.aud !== clientId) throw new Error("Google token audience mismatch");
  if (!claims.sub) throw new Error("Google token is missing subject");
  if (!claims.email || claims.email_verified !== true) throw new Error("Google email is not verified");
  if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Google ID token expired");

  let keys = await googleKeys();
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    jwksCache = null;
    keys = await googleKeys();
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw new Error("Google signing key not found");

  const signature = base64urlDecode(pieces[2]);
  const data = new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`);
  const key = await importJwk(jwk);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!valid) throw new Error("Invalid Google ID token signature");
  return claims;
}

async function hashKey(key: string, pepper: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function generateApiKey(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `mk_live_${base64urlEncode(bytes)}`;
}

async function signInGoogle(request: Request, env: Env, id: string): Promise<Response> {
  let body: { credential?: string };
  try { body = await request.json(); } catch { return error("INVALID_JSON", "Request body must be JSON", id, 400); }
  const credential = String(body.credential ?? "").trim();
  if (!credential) return error("MISSING_CREDENTIAL", "Google credential is required", id, 400);

  let claims: GoogleClaims;
  try { claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID); }
  catch (err) {
    console.error("Google authentication failed", err);
    return error("INVALID_GOOGLE_CREDENTIAL", "Google sign-in could not be verified", id, 401);
  }

  const email = claims.email!.trim().toLowerCase();
  const name = (claims.name?.trim() || email.split("@")[0]).slice(0, 120);

  let customer = await env.DB.prepare(
    `SELECT c.id,c.name,c.email,c.tier,c.monthly_quota,c.rate_limit_per_minute,c.active
       FROM customers c
      WHERE c.google_sub = ?
      LIMIT 1`,
  ).bind(claims.sub).first<Customer>();

  if (!customer) {
    customer = await env.DB.prepare(
      `SELECT c.id,c.name,c.email,c.tier,c.monthly_quota,c.rate_limit_per_minute,c.active
         FROM customers c
        WHERE lower(c.email) = ?
        LIMIT 1`,
    ).bind(email).first<Customer>();
  }

  if (customer) {
    await env.DB.prepare("UPDATE customers SET google_sub=?, email=?, name=? WHERE id=?")
      .bind(claims.sub, email, name || customer.name, customer.id).run();
  } else {
    const plan = await env.DB.prepare(
      `SELECT tier,monthly_quota,rate_limit_per_minute,max_results FROM plans WHERE tier='free' AND active=1 LIMIT 1`,
    ).first<Plan>();
    if (!plan) return error("FREE_PLAN_UNAVAILABLE", "Free plan is not configured", id, 503);
    const customerId = `cus_${crypto.randomUUID().replaceAll("-", "")}`;
    const apiKey = await generateApiKey();
    const keyHash = await hashKey(apiKey, env.API_KEY_PEPPER);
    const created = nowIso();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO customers(id,name,email,google_sub,tier,monthly_quota,rate_limit_per_minute,usage_month,monthly_usage,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(customerId, name, email, claims.sub, plan.tier, plan.monthly_quota, plan.rate_limit_per_minute, monthKey(), 0, 1, created),
      env.DB.prepare(`INSERT INTO api_keys(id,customer_id,key_prefix,key_hash,active,created_at) VALUES(?,?,?,?,?,?)`)
        .bind(`key_${crypto.randomUUID().replaceAll("-", "")}`, customerId, apiKey.slice(0, 16), keyHash, 1, created),
    ]);
    customer = { id: customerId, name, email, tier: plan.tier, monthly_quota: plan.monthly_quota, rate_limit_per_minute: plan.rate_limit_per_minute, active: 1 };
    return json({ customer, plan, api_key: apiKey, created: true }, 200, { "x-request-id": id, "cache-control": "no-store" });
  }

  const keyRow = await env.DB.prepare(
    `SELECT k.key_hash FROM api_keys k WHERE k.customer_id=? AND k.active=1 ORDER BY k.created_at DESC LIMIT 1`,
  ).bind(customer.id).first<{ key_hash: string }>();
  let apiKey: string | null = null;
  if (!keyRow) {
    apiKey = await generateApiKey();
    const keyHash = await hashKey(apiKey, env.API_KEY_PEPPER);
    await env.DB.prepare(`INSERT INTO api_keys(id,customer_id,key_prefix,key_hash,active,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(`key_${crypto.randomUUID().replaceAll("-", "")}`, customer.id, apiKey.slice(0, 16), keyHash, 1, nowIso()).run();
  }
  const plan = await env.DB.prepare(`SELECT tier,monthly_quota,rate_limit_per_minute,max_results FROM plans WHERE tier=? AND active=1 LIMIT 1`).bind(customer.tier).first<Plan>();
  return json({ customer, plan, api_key: apiKey, created: false }, 200, { "x-request-id": id, "cache-control": "no-store" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST,OPTIONS" } });
    if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok", service: "momentum-auth" }, 200, { "x-request-id": id });
    if (url.pathname === "/auth/google" && request.method === "POST") return signInGoogle(request, env, id);
    return error("NOT_FOUND", "Route not found", id, 404);
  },
};
