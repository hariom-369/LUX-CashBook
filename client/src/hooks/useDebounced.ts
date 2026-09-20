import { useEffect, useState } from 'react';

/**
 * Delay a value until it stops changing.
 *
 * Used by every search box in the app: without it, typing "Rahul" fires five
 * queries and the last one is not guaranteed to resolve last — which on a filtered
 * list means showing results for "Rahu".
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
