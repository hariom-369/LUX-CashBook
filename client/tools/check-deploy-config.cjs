// usage: node tools/check-deploy-config.cjs [--require-dist]   (also runs at the end of `npm run build`)
// Fails while client/vercel.json still has the placeholder API origin, because the Content-Security-Policy would
// block every API request from the deployed app (connect-src), checks the policy for the directives that matter, and
// with --require-dist checks the BUILT output (dist/) that Vercel actually serves.
const fs = require('fs');
const path = require('path');
const { headersFingerprint, fingerprintInHtml } = require('./headers-fingerprint.cjs');

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
  // Exactly one rule may set a CSP: a second matching rule would be merged by Vercel into a conflicting second policy.
  const withCsp = (config.headers || []).filter((rule) => rule.headers.some((h) => h.key.toLowerCase() === 'content-security-policy'));
  if (withCsp.length !== 1) problems.push(`exactly one headers rule may define Content-Security-Policy (found ${withCsp.length}).`);
  return problems;
}

/**
 * What is wrong with a BUILT client (dist/) - the output Vercel actually serves, not just the source. Run on every build,
 * so a deployment that would ship the placeholder, a second CSP, or a build made from other headers fails instead.
 */
function checkBuildOutput(distDir, config) {
  const problems = [];
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return [`${distDir} has no index.html - run the build first.`];
  const html = fs.readFileSync(indexPath, 'utf8');
  if (/http-equiv=["']content-security-policy["']/i.test(html)) problems.push('dist/index.html contains a <meta http-equiv="Content-Security-Policy"> that would apply on top of the header.');
  const fp = fingerprintInHtml(html);
  if (!fp) problems.push('dist/index.html has no khata-deploy-headers fingerprint, so a header-only change would not refresh installed clients.');
  else if (fp !== headersFingerprint(config)) problems.push('dist/index.html was built from different headers than the current vercel.json - rebuild.');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(distDir)) {
    const name = path.relative(distDir, file).split(path.sep).join('/');
    if (/(^|\/)(_headers|vercel\.json|netlify\.toml)$/.test(name)) problems.push(`dist/${name} is a second place that could define headers (it would be served alongside vercel.json).`);
    if (!/\.(html|js|css|webmanifest|json)$/.test(name)) continue;
    if (fs.readFileSync(file, 'utf8').includes('api.example.com')) problems.push(`dist/${name} still contains the placeholder api.example.com.`);
  }
  return problems;
}

module.exports = { findProblems, checkBuildOutput };

if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const problems = findProblems(config);
  if (process.argv.includes('--require-dist')) problems.push(...checkBuildOutput(path.join(__dirname, '..', 'dist'), config));
  if (problems.length) {
    console.error('The frontend is not ready to deploy:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log(process.argv.includes('--require-dist') ? 'vercel.json and dist/ look deployable.' : 'vercel.json security headers look deployable.');
}
