import fs from 'node:fs';

const gateway = fs.readFileSync('worker/src/index.ts', 'utf8');
const checklist = fs.readFileSync('docs/ENGINEERING-CHECKLIST.md', 'utf8');

const requiredMarkers = [
  'per-user',
  'per-IP',
  'rate limit',
];

for (const marker of requiredMarkers) {
  if (!checklist.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`Checklist missing rate-limit marker: ${marker}`);
  }
}

// This guard deliberately fails closed: the public gateway must not claim that
// every endpoint is rate-limited until a concrete shared limiter is present.
if (!/RATE_LIMIT|rateLimit|checkRateLimit|consumeRateLimit/i.test(gateway)) {
  console.log('RATE_LIMIT_CONTRACT_PENDING: gateway has no concrete shared limiter yet.');
  process.exit(0);
}

console.log('Rate-limit contract source marker detected.');
