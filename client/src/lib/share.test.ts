import { afterEach, describe, expect, it, vi } from 'vitest';
import { canUseNativeShare, copyToClipboard, shareNatively, whatsAppShareUrl } from './share';

const CONTENT = { title: 'Khata — Test', text: 'Some summary text' };

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('whatsAppShareUrl', () => {
  it('builds a wa.me link with the title and text URL-encoded', () => {
    const url = whatsAppShareUrl(CONTENT);
    expect(url).toBe('https://wa.me/?text=' + encodeURIComponent('Khata — Test\n\nSome summary text'));
  });
});

describe('canUseNativeShare / shareNatively', () => {
  it('reports unavailable when the browser has no Web Share API', async () => {
    expect(canUseNativeShare()).toBe(false);
    expect(await shareNatively(CONTENT)).toBe('unavailable');
  });

  it('returns "shared" when navigator.share resolves', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    expect(await shareNatively(CONTENT)).toBe('shared');
    expect(share).toHaveBeenCalledWith(CONTENT);
  });

  it('returns "cancelled" (not an error) when the user dismisses the OS share sheet', async () => {
    const abortError = new DOMException('The user aborted a request.', 'AbortError');
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(abortError), configurable: true });
    expect(await shareNatively(CONTENT)).toBe('cancelled');
  });

  it('returns "unavailable" on any other share failure, never throwing', async () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(new Error('nope')), configurable: true });
    await expect(shareNatively(CONTENT)).resolves.toBe('unavailable');
  });
});

describe('copyToClipboard', () => {
  it('writes the title and text to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyToClipboard(CONTENT)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Khata — Test\n\nSome summary text');
  });

  it('reports unavailable when clipboard access is blocked, never throwing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
      configurable: true,
    });
    await expect(copyToClipboard(CONTENT)).resolves.toBe('unavailable');
  });
});
