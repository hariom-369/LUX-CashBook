/** A person-friendly device name from a user-agent string. */
export function shortUserAgent(ua: string | undefined): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android device';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Unknown device';
}

export function isMobileUserAgent(ua: string | undefined): boolean {
  return /Mobile|Android|iPhone/i.test(ua ?? '');
}
