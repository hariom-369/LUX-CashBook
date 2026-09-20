import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PettyCashDto, DayClosingDto, MonthClosingDto } from '@khata/shared';
import { api } from './api';
import { useAuthStore } from '../stores/auth.store';

function useWorkspaceId(): string {
  return useAuthStore((s) => s.activeWorkspaceId ?? 'none');
}

export function usePettyCash() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'petty-cash'],
    queryFn: () => api.get<PettyCashDto[]>('/petty-cash'),
    enabled: ws !== 'none',
  });
}

export function useDayClosings(limit = 14) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'day-closings', limit],
    queryFn: () => api.get<DayClosingDto[]>('/closing/day', { query: { limit } }),
    enabled: ws !== 'none',
  });
}

export function useMonthClosings() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'month-closings'],
    queryFn: () => api.get<MonthClosingDto[]>('/closing/month'),
    enabled: ws !== 'none',
  });
}

export interface DayClosingPreview {
  date: string;
  openingCashMinor: number;
  cashReceivedMinor: number;
  cashPaidMinor: number;
  expectedClosingMinor: number;
}

export function useDayClosingPreview(date: string | undefined, accountIds: string[]) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'day-closing-preview', date, accountIds],
    queryFn: () => api.get<DayClosingPreview>('/closing/day/preview', { query: { date, accountIds } }),
    enabled: ws !== 'none' && Boolean(date),
  });
}

export function useInvalidateBusiness() {
  const queryClient = useQueryClient();
  const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';
  return () => {
    for (const key of ['petty-cash', 'day-closings', 'month-closings', 'day-closing-preview', 'accounts', 'transactions', 'dashboard']) {
      void queryClient.invalidateQueries({ queryKey: [ws, key] });
    }
  };
}
