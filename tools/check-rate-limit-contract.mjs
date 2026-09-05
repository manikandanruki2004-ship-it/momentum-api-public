import fs from 'node:fs';

const gateway = fs.readFileSync('worker/src/index.ts', 'utf8');
const config = fs.readFileSync('worker/wrangler.jsonc', 'utf8');
const checklist = fs.readFileSync('docs/ENGINEERING-CHECKLIST.md', 'utf8');

for (const marker of ['per-user', 'per-IP', 'rate limit']) {
  if (!checklist.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`Checklist missing rate-limit marker: ${marker}`);
  }
}

const requiredGatewayPatterns = [
  [/PUBLIC_IP_RATE_LIMIT/, 'public IP limiter binding'],
  [/AUTH_IP_RATE_LIMIT/, 'auth IP limiter binding'],
  [/\.limit\(\{key:/, 'RateLimit.limit key usage'],
  [/code:\"RATE_LIMITED\"/, '429 application error code'],
  [/\},429,\{/, 'HTTP 429 response path'],
  [/retry-after/, 'Retry-After guidance'],
  [/cf-connecting-ip/, 'Cloudflare client IP source'],
];
for (const [pattern, description] of requiredGatewayPatterns) {
  if (!pattern.test(gateway)) throw new Error(`Gateway rate-limit contract failed: ${description}`);
}

for (const [pattern, description] of [
  [/\"ratelimits\"/, 'rate-limit bindings'],
  [/\"PUBLIC_IP_RATE_LIMIT\"/, 'public IP namespace'],
  [/\"AUTH_IP_RATE_LIMIT\"/, 'auth IP namespace'],
]) {
  if (!pattern.test(config)) throw new Error(`Wrangler rate-limit contract failed: ${description}`);
}

console.log('Rate-limit contract checks passed.');
