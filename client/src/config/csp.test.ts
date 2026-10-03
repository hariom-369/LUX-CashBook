import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * The production Content-Security-Policy and headers (client/vercel.json) - see docs/SECURITY.md. These tests pin the
 * exact origins the deployed app talks to, so a typo or a quiet widening shows up here instead of as a blocked login.
 */
const root = join(process.cwd());
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};
const all = vercel.headers.find((h) => h.source === '/(.*)')!;
const header = (name: string) => all.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value ?? '';
const csp = header('Content-Security-Policy');
const directive = (name: string) =>
  (csp.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);

const API_ORIGIN = 'https://lux-cashbook-api.onrender.com';
const FONT_STYLES = 'https://fonts.googleapis.com';
const FONT_FILES = 'https://fonts.gstatic.com';

describe('production CSP: where the app may talk to', () => {
  it('lets the app call the real API origin (login, refresh and every /api/v1 request)', () => {
    expect(directive('connect-src')).toContain(API_ORIGIN);
  });

  it('is exactly this set of connections - the app, the API and the two font hosts - and nothing broader', () => {
    expect(directive('connect-src').sort()).toEqual(["'self'", API_ORIGIN, FONT_STYLES, FONT_FILES].sort());
  });

  it('allows Google Fonts for the page (stylesheet and font files) and for the service worker that caches them', () => {
    expect(directive('style-src')).toContain(FONT_STYLES);
    expect(directive('font-src')).toContain(FONT_FILES);
    // The service worker re-fetches fonts with fetch(), which is governed by connect-src.
    expect(directive('connect-src')).toEqual(expect.arrayContaining([FONT_STYLES, FONT_FILES]));
  });

  it('no longer contains the placeholder API domain anywhere', () => {
    expect(csp).not.toMatch(/api\.example\.com/);
    expect(JSON.stringify(vercel)).not.toMatch(/api\.example\.com/);
  });
});

describe('production CSP: stays restrictive', () => {
  it('has no wildcard, no bare scheme source and no plain-http origin', () => {
    const withoutUpgrade = csp.replace('upgrade-insecure-requests', '');
    expect(withoutUpgrade).not.toMatch(/(^|\s)\*(\s|;|$)/);
    expect(withoutUpgrade).not.toMatch(/\bhttps?:(\s|;|$)/);
    expect(csp).not.toMatch(/http:\/\//);
  });

  it('allows scripts from this origin only - no inline script, no eval', () => {
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(csp).not.toMatch(/unsafe-eval/);
  });

  it('keeps the other directives exactly as they were', () => {
    expect(directive('default-src')).toEqual(["'self'"]);
    expect(directive('style-src').sort()).toEqual(["'self'", "'unsafe-inline'", FONT_STYLES].sort());
    expect(directive('font-src').sort()).toEqual(["'self'", FONT_FILES, 'data:'].sort());
    expect(directive('img-src').sort()).toEqual(["'self'", 'blob:', 'data:'].sort());
    expect(directive('worker-src')).toEqual(["'self'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
    expect(directive('form-action')).toEqual(["'self'"]);
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('does not widen manifest-src (a protected Vercel preview redirecting the manifest to vercel.com/sso-api is not a reason to)', () => {
    expect(directive('manifest-src')).toEqual(["'self'"]);
    expect(csp).not.toMatch(/vercel\.com/);
  });

  it('keeps every other security header unchanged', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('no-referrer');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(header('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(header('Permissions-Policy')).toBe('camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()');
  });

  it('applies to every path, and the service worker is never cached stale', () => {
    expect(all.source).toBe('/(.*)');
    expect(vercel.headers.find((h) => h.source === '/sw.js')?.headers).toEqual([{ key: 'Cache-Control', value: 'no-cache' }]);
  });
});

describe('the pre-deploy check (npm run check:deploy)', () => {
  const { findProblems } = createRequire(import.meta.url)(join(root, 'tools', 'check-deploy-config.cjs')) as {
    findProblems: (config: unknown) => string[];
  };
  const withCsp = (value: string) => ({ headers: [{ source: '/(.*)', headers: all.headers.map((h) => (h.key === 'Content-Security-Policy' ? { ...h, value } : h)) }] });

  it('accepts the real configuration', () => {
    expect(findProblems(vercel)).toEqual([]);
  });

  it('rejects the placeholder API domain', () => {
    const problems = findProblems(withCsp(csp.replace(API_ORIGIN, 'https://api.example.com')));
    expect(problems.join(' ')).toMatch(/placeholder https:\/\/api\.example\.com/);
  });

  it('rejects a policy with no API origin at all', () => {
    expect(findProblems(withCsp(csp.replace(API_ORIGIN, ''))).join(' ')).toMatch(/names no https API origin/);
  });

  it('rejects wildcards, bare schemes, plain http and unsafe script sources', () => {
    expect(findProblems(withCsp(csp.replace(API_ORIGIN, '*'))).join(' ')).toMatch(/wildcard/);
    expect(findProblems(withCsp(csp.replace("script-src 'self'", "script-src 'self' https:"))).join(' ')).toMatch(/wildcard or a bare scheme/);
    expect(findProblems(withCsp(csp.replace(API_ORIGIN, 'http://api.example.org'))).join(' ')).toMatch(/plain-http/);
    expect(findProblems(withCsp(csp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))).join(' ')).toMatch(/unsafe-inline/);
  });
});

describe('index.html', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');

  it('declares the standard web-app-capable tag next to the Apple one', () => {
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
  });

  it('keeps scripts and the font swap out of the page itself (no inline script or handler for the CSP to refuse)', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son(load|click|error)=/);
  });
});


/** Every place the client could define a CSP: there must be exactly one (vercel.json), so nothing can override it. */
describe('no second or conflicting CSP definition', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (['node_modules', 'dist', '.git', '.vercel'].includes(name)) return [];
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const files = walk(root);
  const rel = (f: string) => f.slice(root.length + 1).split('\\').join('/');
  const text = (f: string) => readFileSync(f, 'utf8');

  it('finds the client sources it is meant to scan', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toEqual(expect.arrayContaining(['vercel.json', 'index.html', 'vite.config.ts', 'src/sw.ts']));
  });

  it('has exactly one headers rule that sets a Content-Security-Policy, and it is the catch-all', () => {
    const rules = vercel.headers.filter((r) => r.headers.some((h) => h.key.toLowerCase() === 'content-security-policy'));
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('/(.*)');
    expect(all.headers.filter((h) => h.key.toLowerCase() === 'content-security-policy')).toHaveLength(1);
  });

  it('has no other file that configures response headers (vercel.json elsewhere, _headers, netlify.toml)', () => {
    const configs = files.map(rel).filter((f) => /(^|\/)(vercel\.json|_headers|netlify\.toml|vercel\.ts)$/.test(f));
    expect(configs).toEqual(['vercel.json']);
    // Nor a root-level one in the repository, which Vercel would read instead if the project root were the repo.
    expect(() => statSync(join(root, '..', 'vercel.json'))).toThrow();
  });

  it('has no CSP <meta> tag in any HTML file', () => {
    const html = files.filter((f) => f.endsWith('.html'));
    expect(html.length).toBeGreaterThan(0);
    for (const file of html) expect(text(file), rel(file)).not.toMatch(/http-equiv\s*=\s*["']content-security-policy["']/i);
  });

  it('writes a CSP nowhere else: not in the Vite config, the service worker, or application code', () => {
    const offenders = files
      .filter((f) => /\.(ts|tsx|js|cjs|mjs|html)$/.test(f))
      .map(rel)
      .filter((f) => !f.startsWith('tools/') && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
      .filter((f) => /default-src\s+['"]?(self|none)/i.test(text(join(root, f))));
    expect(offenders).toEqual([]);
  });

  it('never mentions the placeholder API origin outside the tests and the checks that reject it', () => {
    const offenders = files
      .map(rel)
      .filter((f) => /\.(ts|tsx|js|cjs|mjs|html|json|css)$/.test(f))
      .filter((f) => !f.endsWith('csp.test.ts') && f !== 'tools/check-deploy-config.cjs' && f !== 'tools/check-live-headers.cjs')
      .filter((f) => text(join(root, f)).includes('api.example.com'));
    expect(offenders).toEqual([]);
  });

  it('serves the preview with the very headers production uses (vite.config reads vercel.json, it does not copy them)', () => {
    const config = text(join(root, 'vite.config.ts'));
    expect(config).toContain("'./vercel.json'");
    expect(config).not.toMatch(/Content-Security-Policy['"]\s*:/);
  });

  it('does not make the service worker add or change response headers', () => {
    const sw = text(join(root, 'src', 'sw.ts'));
    expect(sw).not.toMatch(/new Headers|\.headers\.set\(|Content-Security-Policy/i);
  });
});

describe('the build output is checked, not just the source', () => {
  const { checkBuildOutput } = createRequire(import.meta.url)(join(root, 'tools', 'check-deploy-config.cjs')) as {
    checkBuildOutput: (dist: string, config: unknown) => string[];
  };
  const { headersFingerprint, fingerprintInHtml } = createRequire(import.meta.url)(join(root, 'tools', 'headers-fingerprint.cjs')) as {
    headersFingerprint: (config: unknown) => string;
    fingerprintInHtml: (html: string) => string | null;
  };
  const page = (fingerprint: string | null = headersFingerprint(vercel), extra = '') =>
    `<!doctype html><html><head><meta charset="UTF-8" />${fingerprint ? `<meta name="khata-deploy-headers" content="${fingerprint}" />` : ''}${extra}</head><body></body></html>`;
  const build = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'khata-dist-'));
    mkdirSync(join(dir, 'assets'));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  };

  it('passes a clean build', () => {
    expect(checkBuildOutput(build({ 'index.html': page(), 'assets/app.js': 'fetch("https://lux-cashbook-api.onrender.com")' }), vercel)).toEqual([]);
  });

  it('fails a build that still contains the placeholder, in any asset', () => {
    const problems = checkBuildOutput(build({ 'index.html': page(), 'assets/app.js': 'const api="https://api.example.com/api/v1"' }), vercel);
    expect(problems.join(' ')).toMatch(/dist\/assets\/app\.js still contains the placeholder/);
  });

  it('fails a build whose index.html carries its own CSP <meta>', () => {
    const meta = '<meta http-equiv="Content-Security-Policy" content="default-src self; connect-src https://api.example.com">';
    expect(checkBuildOutput(build({ 'index.html': page(undefined, meta) }), vercel).join(' ')).toMatch(/http-equiv="Content-Security-Policy"/);
  });

  it('fails a build made from different headers, or with no fingerprint at all', () => {
    expect(checkBuildOutput(build({ 'index.html': page('0123456789abcdef') }), vercel).join(' ')).toMatch(/different headers/);
    expect(checkBuildOutput(build({ 'index.html': page(null) }), vercel).join(' ')).toMatch(/no khata-deploy-headers fingerprint/);
  });

  it('fails a build that ships a second place to set headers', () => {
    expect(checkBuildOutput(build({ 'index.html': page(), _headers: '/*\n  Content-Security-Policy: default-src *' }), vercel).join(' ')).toMatch(/second place that could define headers/);
  });

  it('fails when there is no build', () => {
    expect(checkBuildOutput(join(tmpdir(), 'khata-no-such-dist'), vercel).join(' ')).toMatch(/run the build first/);
  });

  it('fingerprints the headers, so a header-only change changes index.html (and so the service worker refetches it)', () => {
    const changed = JSON.parse(JSON.stringify(vercel)) as typeof vercel;
    changed.headers[0]!.headers[0]!.value = csp.replace(API_ORIGIN, 'https://api.example.com');
    expect(headersFingerprint(vercel)).toMatch(/^[0-9a-f]{16}$/);
    expect(headersFingerprint(vercel)).toBe(headersFingerprint(JSON.parse(JSON.stringify(vercel))));
    expect(headersFingerprint(changed)).not.toBe(headersFingerprint(vercel));
    expect(fingerprintInHtml(page('00ff00ff00ff00ff'))).toBe('00ff00ff00ff00ff');
    expect(fingerprintInHtml(page(null))).toBeNull();
  });
});

describe('the live-site check (npm run check:live -- <url>)', () => {
  const { compareLive } = createRequire(import.meta.url)(join(root, 'tools', 'check-live-headers.cjs')) as {
    compareLive: (live: { headers: Record<string, string>; html: string }, config: unknown) => string[];
  };
  const { headersFingerprint } = createRequire(import.meta.url)(join(root, 'tools', 'headers-fingerprint.cjs')) as { headersFingerprint: (config: unknown) => string };
  const expectedHeaders = () => Object.fromEntries(all.headers.map((h) => [h.key.toLowerCase(), h.value]));
  const html = (fp = headersFingerprint(vercel)) => `<html><head><meta name="khata-deploy-headers" content="${fp}" /></head></html>`;

  it('accepts a deployment that serves exactly what vercel.json says', () => {
    expect(compareLive({ headers: expectedHeaders(), html: html() }, vercel)).toEqual([]);
  });

  it('names the stale policy when the live site still sends the old one', () => {
    const headers = { ...expectedHeaders(), 'content-security-policy': csp.replace(API_ORIGIN, 'https://api.example.com') };
    const problems = compareLive({ headers, html: html() }, vercel).join(' | ');
    expect(problems).toMatch(/not the one in vercel\.json/);
    expect(problems).toMatch(/connect-src 'self' https:\/\/api\.example\.com/);
    expect(problems).toMatch(/placeholder https:\/\/api\.example\.com/);
  });

  it('detects a second, overriding policy', () => {
    const headers = { ...expectedHeaders(), 'content-security-policy': `${csp}, default-src 'self'; connect-src https://api.example.com` };
    expect(compareLive({ headers, html: html() }, vercel).join(' ')).toMatch(/more than one Content-Security-Policy/);
  });

  it('detects a missing header and a CSP <meta> in the page', () => {
    const headers = expectedHeaders();
    delete headers['referrer-policy'];
    expect(compareLive({ headers, html: html() }, vercel).join(' ')).toMatch(/referrer-policy is missing/);
    expect(compareLive({ headers: expectedHeaders(), html: html() + '<meta http-equiv="Content-Security-Policy" content="x">' }, vercel).join(' ')).toMatch(/<meta http-equiv/);
  });

  it('shows which build is live: no fingerprint means an older deployment, a different one means the latest commit is not served', () => {
    expect(compareLive({ headers: expectedHeaders(), html: '<html></html>' }, vercel).join(' ')).toMatch(/predates this fix/);
    expect(compareLive({ headers: expectedHeaders(), html: html('1111111111111111') }, vercel).join(' ')).toMatch(/latest commit is not what Vercel is serving/);
  });
});
