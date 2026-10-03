// usage: node tools/check-deploy-config.cjs   (run before deploying the frontend)
// Fails while client/vercel.json still has the placeholder API origin, because the Content-Security-Policy would
// block every API request from the deployed app (connect-src), and checks the policy for the directives that matter.
const fs = require('fs');
const path = require('path');

/** Everything wrong with a parsed vercel.json, as readable sentences (empty = deployable). Pure, so it is unit-tested. */
function findProblems(config) {
  const all = (config.headers || []).find((h) => h.source === '/(.*)');
  if (!all) return ['vercel.json has no headers for "/(.*)".'];
  const get = (k) => (all.headers.find((h) => h.key.toLowerCase() === k.toLowerCase()) || {}).value || '';
  const csp = get('Content-Security-Policy');
  const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '').split(/\s+/).slice(1);
  const problems = [];
  if (csp.includes('api.example.com')) problems.push("connect-src still names the placeholder https://api.example.com - replace it with your API's origin (e.g. https://api.yourdomain.com).");
  const apiOrigins = directive('connect-src').filter((s) => /^https:\/\/(?!fonts\.(googleapis|gstatic)\.com$)[^\s/*]+$/.test(s));
  if (apiOrigins.length === 0) problems.push('connect-src names no https API origin.');
  for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) if (!csp.includes(d)) problems.push(`CSP is missing ${d}`);
  if (/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp)) problems.push("script-src must not allow 'unsafe-inline' or 'unsafe-eval'.");
  if (/(^|\s)\*(\s|;|$)|https?:\/\/\*|\bhttps?:(\s|;|$)/.test(csp.replace(/upgrade-insecure-requests/, ''))) problems.push('the CSP must not use a wildcard or a bare scheme source.');
  if (/(^|\s)http:\/\//.test(csp)) problems.push('the CSP must not allow plain-http origins.');
  for (const k of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security']) if (!get(k)) problems.push(`missing header ${k}`);
  return problems;
}

module.exports = { findProblems };

if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const problems = findProblems(config);
  if (problems.length) {
    console.error('vercel.json is not ready to deploy:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log('vercel.json security headers look deployable.');
}
