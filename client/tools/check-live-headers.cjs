// usage: node tools/check-live-headers.cjs https://your-site.vercel.app
//
// Fetches the DEPLOYED site (not the source) and compares what Vercel actually serves with client/vercel.json:
// every security header, that the Content-Security-Policy is exactly one policy (no second, overriding one), the
// placeholder API origin, and the fingerprint the build writes into index.html (which proves which build is live).
// Plain HTTP requests bypass the browser's service worker, so this shows what the server sends - if it is right but
// a browser still shows the old policy, that browser is running an old service worker (see docs/DEPLOYMENT.md).
const fs = require('fs');
const path = require('path');
const { headersFingerprint, fingerprintInHtml } = require('./headers-fingerprint.cjs');

const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();

/** What differs between a live response and vercel.json, as sentences. `live`: { headers: {lowercased name: value}, html }. */
function compareLive(live, config) {
  const expected = Object.fromEntries(config.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key.toLowerCase(), h.value]));
  const problems = [];
  for (const [name, want] of Object.entries(expected)) {
    const got = live.headers[name];
    if (got === undefined) problems.push(`header ${name} is missing from the live response`);
    else if (norm(got) !== norm(want)) {
      if (name === 'content-security-policy') {
        const wantParts = new Set(norm(want).split(';').map((d) => d.trim()).filter(Boolean));
        const gotParts = norm(got).split(';').map((d) => d.trim()).filter(Boolean);
        const stale = gotParts.filter((d) => !wantParts.has(d));
        problems.push(`the live Content-Security-Policy is not the one in vercel.json. Live-only directives: ${stale.join(' | ') || '(none)'}`);
      } else problems.push(`header ${name} differs: live "${got}" vs vercel.json "${want}"`);
    }
  }
  const csp = live.headers['content-security-policy'] || '';
  if (/api\.example\.com/.test(csp)) problems.push('the live CSP still contains the placeholder https://api.example.com');
  if (/,\s*default-src/.test(csp) || (csp.match(/default-src/g) || []).length > 1) problems.push('the live response carries more than one Content-Security-Policy (a second, overriding policy)');
  if (/http-equiv=["']content-security-policy["']/i.test(live.html || '')) problems.push('index.html contains a <meta http-equiv="Content-Security-Policy"> that also applies');
  const live_fp = fingerprintInHtml(live.html || '');
  const want_fp = headersFingerprint(config);
  if (!live_fp) problems.push('the live index.html has no khata-deploy-headers fingerprint: the deployed build predates this fix (or is not this repository)');
  else if (live_fp !== want_fp) problems.push(`the live build was made with different headers (fingerprint ${live_fp}, this repository's vercel.json is ${want_fp}): the latest commit is not what Vercel is serving`);
  return problems;
}

async function fetchLive(base) {
  const bust = `?_=${Date.now()}`;
  const get = async (p) => {
    const res = await fetch(base.replace(/\/$/, '') + p + bust, { headers: { 'cache-control': 'no-cache', pragma: 'no-cache' }, redirect: 'manual' });
    return { status: res.status, headers: Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v])), html: res.headers.get('content-type')?.includes('html') ? await res.text() : '' };
  };
  return { login: await get('/login'), root: await get('/'), sw: await get('/sw.js') };
}

module.exports = { compareLive };

if (require.main === module) {
  const base = process.argv[2];
  if (!base || !/^https:\/\//.test(base)) {
    console.error('usage: node tools/check-live-headers.cjs https://your-site.vercel.app');
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  fetchLive(base).then((live) => {
    let failed = false;
    for (const [label, page] of [['/login', live.login], ['/', live.root]]) {
      const problems = compareLive(page, config);
      console.log(`${label}  status ${page.status}  x-vercel-cache: ${page.headers['x-vercel-cache'] || '-'}  age: ${page.headers.age || '-'}  x-vercel-id: ${page.headers['x-vercel-id'] || '-'}`);
      if (problems.length) {
        failed = true;
        for (const p of problems) console.log('   - ' + p);
      } else console.log('   headers, CSP and build fingerprint match vercel.json');
    }
    if (!/no-cache/.test(live.sw.headers['cache-control'] || '')) { failed = true; console.log('/sw.js is not served with Cache-Control: no-cache, so clients may not notice a new service worker'); }
    process.exit(failed ? 1 : 0);
  }).catch((e) => { console.error('could not fetch the site:', e.message); process.exit(2); });
}
