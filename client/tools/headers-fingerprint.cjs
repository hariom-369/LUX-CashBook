// A short fingerprint of the deployment headers and rewrites in vercel.json.
//
// Why it exists: the service worker precaches index.html together with the response headers it arrived with - and a
// document's Content-Security-Policy is the one on the response that produced it. Workbox only re-downloads a precached
// file when its revision (a hash of the file's content) changes. So a deployment that changes headers in vercel.json but
// leaves index.html byte-identical would keep serving the OLD policy to every installed client, indefinitely. The build
// writes this fingerprint into index.html (a <meta>), so any header change also changes index.html, hence its revision,
// hence a refetch with the new headers.
const { createHash } = require('node:crypto');

function headersFingerprint(config) {
  const canonical = JSON.stringify({ headers: config.headers ?? [], rewrites: config.rewrites ?? [] });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

const META_NAME = 'khata-deploy-headers';

/** The fingerprint a built index.html carries, or null. */
function fingerprintInHtml(html) {
  const match = new RegExp('<meta\\s+name="' + META_NAME + '"\\s+content="([0-9a-f]{16})"').exec(html);
  return match ? match[1] : null;
}

module.exports = { headersFingerprint, fingerprintInHtml, META_NAME };
