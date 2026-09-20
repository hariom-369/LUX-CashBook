import { useEffect, useState } from 'react';

/**
 * `navigator.onLine` alone is unreliable (it can report `true` on a connection
 * that is actually unreachable — captive portals, a dead Wi-Fi with no internet
 * behind it). It is still the right *first* signal because it costs nothing and
 * catches the common case (airplane mode, no adapter) instantly; the offline
 * sync engine layers a real network check on top before trusting it for a retry.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
