import fs from "node:fs";

const auth = fs.readFileSync("auth/src/index.ts", "utf8");

const required = [
  ['request.headers.get("cf-connecting-ip")', "auth throttling trusts the Cloudflare client-IP header"],
  ["INSERT INTO auth_rate_limits", "auth failure recording uses an upsert"],
  ["ON CONFLICT(key_hash) DO UPDATE SET", "auth failure updates are atomic at the row level"],
  ["MIN(auth_rate_limits.failures+1,?)", "auth failures remain bounded"],
  ["substr(key_prefix,1,11)='mk_session_'", "session API-key cleanup is scoped to session keys"],
  ["await env.DB.batch([env.DB.prepare(\"DELETE FROM auth_sessions", "logout invalidates session state and API-key state together"],
];

for (const [needle, description] of required) {
  if (!auth.includes(needle)) throw new Error(`Auth throttle check failed: ${description}`);
}

if (auth.includes("x-forwarded-for") || auth.includes("x-forwarded-for")) {
  throw new Error("Auth throttle check failed: spoofable x-forwarded-for fallback remains");
}

console.log("Auth throttle contract checks passed.");
