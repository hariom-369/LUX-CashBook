import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import { composeTitle } from '../hooks/useDocumentMeta';
import { pageTitleKeys } from '../lib/pageTitle';

/**
 * Makes a client-side navigation perceivable to a screen-reader user (WCAG 2.4.2, 4.1.3).
 *
 * A single-page app never reloads, so without this the browser's title never changes and
 * nothing tells a non-visual user that the page they activated has loaded. It updates
 * `document.title` and announces the new page name through a polite live region. It does
 * not move focus: stealing focus from the sidebar link someone just activated would break
 * their place in the navigation.
 */
export function RouteAnnouncer() {
  const t = useT();
  const { pathname } = useLocation();
  const [announcement, setAnnouncement] = useState('');
  const first = useRef(true);

  const parts = pageTitleKeys(pathname).map((key) => t(key));
  const title = composeTitle(parts);

  useEffect(() => {
    document.title = title;
    // The initial load is announced by the browser itself; only announce changes.
    if (first.current) {
      first.current = false;
      return;
    }
    setAnnouncement(parts.join(' — '));
    // `parts` is derived from `title`; depending on `title` alone avoids re-announcing on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, title]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
