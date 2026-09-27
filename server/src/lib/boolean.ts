/**
 * Read a boolean written as a word — the way environment variables and query
 * strings carry them.
 *
 * `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off` (any case) become booleans;
 * anything else is returned unchanged so a schema can reject it with a clear
 * message. This exists because `z.coerce.boolean()` is `Boolean(value)`: every
 * non-empty string is true, so `?includeDone=false` or `COOKIE_CROSS_SITE=false`
 * silently meant the opposite of what was written.
 */
export function booleanWord(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return value;
}
