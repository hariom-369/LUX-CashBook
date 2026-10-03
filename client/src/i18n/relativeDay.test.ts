import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { relativeDay } from '@khata/shared';
import { useRelativeDay } from './relativeDay';
import { useAuthStore } from '../stores/auth.store';
import { hi } from './messages/hi';

const now = new Date('2026-10-10T12:00:00');
const daysFromNow = (n: number) => new Date(now.getTime() + n * 86_400_000);

afterEach(() => act(() => useAuthStore.setState({ user: null } as never)));

describe('useRelativeDay (§Phase 14)', () => {
  it('matches the shared English helper when no language is set', () => {
    const { result } = renderHook(() => useRelativeDay());
    for (const n of [-30, -5, -1, 0, 1, 3, 6, 40]) {
      expect(result.current(daysFromNow(-n), now), String(n)).toBe(relativeDay(daysFromNow(-n), now));
    }
  });

  it('speaks Hindi for today, yesterday, tomorrow and nearby days', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    const { result } = renderHook(() => useRelativeDay());
    expect(result.current(now, now)).toBe(hi['date.today']);
    expect(result.current(daysFromNow(-1), now)).toBe(hi['date.yesterday']);
    expect(result.current(daysFromNow(1), now)).toBe(hi['date.tomorrow']);
    expect(result.current(daysFromNow(-3), now)).toBe('3 दिन पहले');
    expect(result.current(daysFromNow(4), now)).toBe('4 दिन में');
  });

  it('falls back to the shared date for anything a week or more away, and "—" for garbage', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    const { result } = renderHook(() => useRelativeDay());
    expect(result.current(daysFromNow(-30), now)).toBe(relativeDay(daysFromNow(-30), now));
    expect(result.current('not a date', now)).toBe('—');
  });
});
