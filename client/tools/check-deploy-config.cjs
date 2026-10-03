// usage: node tools/check-deploy-config.cjs   (run before deploying the frontend)
// Fails while client/vercel.json still has the placeholder API origin, because the Content-Security-Policy would
// block every API request from the deployed app (connect-src), and checks the policy for the directives that matter.
const fs = require('fs');
const path = require('path');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const all = config.headers.find((h) => h.source === '/(.*)');
const get = (k) => (all.headers.find((h) => h.key.toLowerCase() === k.toLowerCase()) || {}).value || '';
const csp = get('Content-Security-Policy');
const problems = [];
if (csp.includes('api.example.com')) problems.push("connect-src still names the placeholder https://api.example.com - replace it with your API's origin (e.g. https://api.yourdomain.com).");
if (!/connect-src[^;]*https:\/\/[^;\s]+/.test(csp)) problems.push('connect-src names no https API origin.');
for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) if (!csp.includes(d)) problems.push(`CSP is missing ${d}`);
if (/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp)) problems.push("script-src must not allow 'unsafe-inline' or 'unsafe-eval'.");
for (const k of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security']) if (!get(k)) problems.push(`missing header ${k}`);
if (problems.length) { console.error('vercel.json is not ready to deploy:\n  - ' + problems.join('\n  - ')); process.exit(1); }
console.log('vercel.json security headers look deployable.');
