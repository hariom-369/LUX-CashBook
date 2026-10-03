import { tNow } from '../../i18n';

/** A person-friendly device name from a user-agent string. */
export function shortUserAgent(ua: string | undefined): string {
  if (!ua) return tNow('device.unknown');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return tNow('device.android');
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return tNow('device.windows');
  if (/Linux/i.test(ua)) return tNow('device.linux');
  return tNow('device.unknown');
}

export function isMobileUserAgent(ua: string | undefined): boolean {
  return /Mobile|Android|iPhone/i.test(ua ?? '');
}
