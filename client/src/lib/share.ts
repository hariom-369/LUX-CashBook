/**
 * Share (§36, §48).
 *
 * Three paths, tried in order of how directly they hand the content to another
 * app: the OS share sheet (`navigator.share`, mobile Safari/Chrome and some
 * desktop browsers), a WhatsApp compose link (the one explicitly asked for,
 * works everywhere via a plain `https://wa.me` URL with no API key or
 * WhatsApp-side integration needed), and the clipboard as the universal
 * fallback that always works. Nothing here ever includes account numbers or
 * raw ledger data automatically — every caller builds its own summary text, so
 * what gets shared is exactly what the screen already shows the user.
 */
export interface ShareContent {
  title: string;
  text: string;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'unavailable';

export function canUseNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareNatively(content: ShareContent): Promise<ShareResult> {
  if (!canUseNativeShare()) return 'unavailable';
  try {
    await navigator.share(content);
    return 'shared';
  } catch (err) {
    // The user closing the OS share sheet is not a failure worth surfacing. The
    // browser throws a DOMException here, which — unlike most exceptions in this
    // codebase — is not reliably `instanceof Error` across environments, so this
    // checks `.name` directly rather than narrowing on `Error` first.
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return 'cancelled';
    return 'unavailable';
  }
}

export async function copyToClipboard(content: ShareContent): Promise<ShareResult> {
  try {
    await navigator.clipboard.writeText(`${content.title}\n\n${content.text}`);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}

export function whatsAppShareUrl(content: ShareContent): string {
  return `https://wa.me/?text=${encodeURIComponent(`${content.title}\n\n${content.text}`)}`;
}
