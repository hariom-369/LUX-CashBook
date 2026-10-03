/* global window, document, localStorage */
/*
 * Runs before first paint, from <head>, as a same-origin file (no inline script, so the CSP stays strict).
 *
 * Theme and privacy mode are applied here, synchronously: if React did it, the page would render in light mode
 * and then snap to dark - the "flash of wrong theme" that instantly makes an app feel cheap. Reading
 * localStorage synchronously in <head> is the only way to avoid it.
 *
 * It also switches the web-font stylesheet from `media="print"` (so it never blocks rendering) to `all` once it
 * has loaded - previously an inline `onload` attribute, which a strict CSP would refuse.
 */
(function () {
  try {
    var stored = localStorage.getItem('khata.theme') || 'system';
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

    if (localStorage.getItem('khata.privacy') === '1') {
      document.documentElement.classList.add('privacy');
    }

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0e0e0c' : '#f7f5f0');
  } catch {
    /* Private browsing can throw on localStorage; the default theme is fine. */
  }

  // The <link> above this script is already in the document, so the listener is attached before it can finish loading.
  var fonts = document.getElementById('khata-fonts');
  if (fonts) {
    var show = function () {
      fonts.media = 'all';
    };
    fonts.addEventListener('load', show);
    if (fonts.sheet) show();
  }
})();
