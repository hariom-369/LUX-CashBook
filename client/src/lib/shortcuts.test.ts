import { describe, expect, it } from 'vitest';
import { resolveShortcut } from './shortcuts';

const key = (k: string, extra: Partial<Parameters<typeof resolveShortcut>[0]> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra,
});

describe('keyboard shortcuts', () => {
  it('maps n, ? and g', () => {
    expect(resolveShortcut(key('n'), false)).toEqual({ type: 'quickAdd' });
    expect(resolveShortcut(key('?'), false)).toEqual({ type: 'help' });
    expect(resolveShortcut(key('g'), false)).toEqual({ type: 'pendingG' });
  });

  it('completes a g-sequence and ignores unknown follow-ups', () => {
    expect(resolveShortcut(key('t'), true)).toEqual({ type: 'go', to: '/transactions' });
    expect(resolveShortcut(key('z'), true)).toBeNull();
  });

  it('never fires while typing or with a modifier held', () => {
    const input = document.createElement('input');
    expect(resolveShortcut(key('n', { target: input }), false)).toBeNull();
    expect(resolveShortcut(key('n', { ctrlKey: true }), false)).toBeNull();
    expect(resolveShortcut(key('n', { metaKey: true }), false)).toBeNull();
  });
});
