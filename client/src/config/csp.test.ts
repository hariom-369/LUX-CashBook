import { readFileSync } from 'node:fs';
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
