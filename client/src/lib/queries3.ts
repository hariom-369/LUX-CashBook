import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BudgetProgressDto,
  GoalProgressDto,
  NetWorthDto,
  NotificationDto,
  RecurringTransactionDto,
  ReminderDto,
} from '@khata/shared';
import { api } from './api';
import { useAuthStore } from '../stores/auth.store';
import type { BorrowLendRow, MonthSummaryRow } from './reportTypes';

/**
 * Phase 3 server-state hooks — budgets, goals, recurring, reminders,
 * notifications and reports. Kept in their own module rather than growing
 * `queries.ts` indefinitely; the workspace-scoped key convention is identical.
 */

function useWorkspaceId(): string {
  return useAuthStore((s) => s.activeWorkspaceId ?? 'none');
}

export function useBudgets() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'budgets'],
    queryFn: () => api.get<BudgetProgressDto[]>('/budgets'),
    enabled: ws !== 'none',
  });
}

export function useGoals() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'goals'],
    queryFn: () => api.get<GoalProgressDto[]>('/goals'),
    enabled: ws !== 'none',
  });
}

export function useRecurring() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'recurring'],
    queryFn: () => api.get<RecurringTransactionDto[]>('/recurring'),
    enabled: ws !== 'none',
  });
}

export function useReminders(includeDone = false) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'reminders', includeDone],
    queryFn: () => api.get<ReminderDto[]>('/reminders', { query: { includeDone } }),
    enabled: ws !== 'none',
  });
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => api.getWithMeta<NotificationDto[]>('/notifications', { query: { unreadOnly } }),
    // Notifications are account-wide; refresh reasonably often since nothing
    // pushes updates to the client yet (no websocket in this phase).
    refetchInterval: 60_000,
  });
}

export function useNetWorth(months = 6) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'net-worth', months],
    queryFn: () => api.get<NetWorthDto>('/reports/net-worth', { query: { months } }),
    enabled: ws !== 'none',
  });
}

export function useMonthlyComparison(months = 12) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'monthly-comparison', months],
    queryFn: () => api.get<MonthSummaryRow[]>('/reports/monthly-comparison', { query: { months } }),
    enabled: ws !== 'none',
  });
}

export function useBorrowLendReport() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'borrow-lend-report'],
    queryFn: () => api.get<BorrowLendRow[]>('/reports/borrow-lend'),
    enabled: ws !== 'none',
  });
}

export function useCategoryReport(kind: 'income' | 'expense', range: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'category-report', kind, range],
    queryFn: () => api.get('/reports/category', { query: { kind, range } }),
    enabled: ws !== 'none',
  });
}

/** Invalidate everything Phase 3 planning data could have affected. */
export function useInvalidatePlanning() {
  const queryClient = useQueryClient();
  const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';
  return () => {
    for (const key of ['budgets', 'goals', 'recurring', 'reminders']) {
      void queryClient.invalidateQueries({ queryKey: [ws, key] });
    }
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
}
