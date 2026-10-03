import { useCallback } from 'react';
import { diffInDays, relativeDay } from '@khata/shared';
import { useT } from './index';

/**
 * `relativeDay` from `@khata/shared`, in the signed-in language. The shared helper returns
 * fixed English ("Today", "3 days ago"); this swaps the words and defers to it for
 * anything further out (a plain date, which the app already formats by the user's date setting).
 */
export function useRelativeDay() {
  const t = useT();
  return useCallback(
    (d: Date | string, now: Date = new Date()): string => {
      const date = typeof d === 'string' ? new Date(d) : d;
      if (Number.isNaN(date.getTime())) return '—';
      const delta = diffInDays(now, date);
      if (delta === 0) return t('date.today');
      if (delta === 1) return t('date.yesterday');
      if (delta === -1) return t('date.tomorrow');
      if (delta > 1 && delta < 7) return t('date.daysAgo', { count: delta });
      if (delta < -1 && delta > -7) return t('date.inDays', { count: Math.abs(delta) });
      return relativeDay(d, now);
    },
    [t],
  );
}
