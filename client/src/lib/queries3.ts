import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiStatusDto,
  AttachmentDto,
  BudgetProgressDto,
  BudgetSuggestionDto,
  CardSummaryDto,
  CashFlowForecastDto,
  DocumentType,
  ExpenseGroupDto,
  GoalProgressDto,
  GroupExpenseDto,
  GroupMemberBalanceDto,
  InvitationDto,
  NetWorthDto,
  NotificationDto,
  RecurringTransactionDto,
  ReminderDto,
  SubscriptionSuggestionDto,
  WorkspaceMemberDto,
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

export function useDetectorSuggestions() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'detector-subscriptions'],
    queryFn: () => api.get<SubscriptionSuggestionDto[]>('/detector/subscriptions'),
    enabled: ws !== 'none',
  });
}

export interface DocumentFilters {
  docType?: DocumentType;
  tags?: string;
  search?: string;
  includeDeleted?: boolean;
}

export function useDocuments(filters: DocumentFilters = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'documents', filters],
    queryFn: () => api.get<AttachmentDto[]>('/attachments', { query: filters as Record<string, string> }),
    enabled: ws !== 'none',
  });
}

export function useGroups() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'groups'],
    queryFn: () => api.get<ExpenseGroupDto[]>('/groups'),
    enabled: ws !== 'none',
  });
}

export function useGroup(groupId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'group', groupId],
    queryFn: () => api.get<ExpenseGroupDto>(`/groups/${groupId}`),
    enabled: ws !== 'none' && Boolean(groupId),
  });
}

export function useGroupExpenses(groupId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'group-expenses', groupId],
    queryFn: () => api.get<GroupExpenseDto[]>(`/groups/${groupId}/expenses`),
    enabled: ws !== 'none' && Boolean(groupId),
  });
}

export function useGroupBalances(groupId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'group-balances', groupId],
    queryFn: () => api.get<GroupMemberBalanceDto[]>(`/groups/${groupId}/balances`),
    enabled: ws !== 'none' && Boolean(groupId),
  });
}

export function useInvalidateGroup(groupId: string | undefined) {
  const queryClient = useQueryClient();
  const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';
  return () => {
    void queryClient.invalidateQueries({ queryKey: [ws, 'groups'] });
    void queryClient.invalidateQueries({ queryKey: [ws, 'group', groupId] });
    void queryClient.invalidateQueries({ queryKey: [ws, 'group-expenses', groupId] });
    void queryClient.invalidateQueries({ queryKey: [ws, 'group-balances', groupId] });
  };
}

export function useMembers() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'members'],
    queryFn: () => api.get<WorkspaceMemberDto[]>('/members'),
    enabled: ws !== 'none',
  });
}

export function useWorkspaceInvitations() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'workspace-invitations'],
    queryFn: () => api.get<InvitationDto[]>('/workspace-invitations'),
    enabled: ws !== 'none',
  });
}

/** Whether the server has a provider key configured and this user opted in — drives whether the Assistant UI shows at all (§Phase 10). */
export function useAiStatus() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'ai-status'],
    queryFn: () => api.get<AiStatusDto>('/ai/status'),
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

export function useForecast(days = 30) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'forecast', days],
    queryFn: () => api.get<CashFlowForecastDto>('/forecast', { query: { days } }),
    enabled: ws !== 'none',
  });
}

export function useBudgetSuggestions() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'budget-suggestions'],
    queryFn: () => api.get<BudgetSuggestionDto[]>('/budgets/suggestions'),
    enabled: ws !== 'none',
  });
}

export function useCardSummary(accountId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'card-summary', accountId],
    queryFn: () => api.get<CardSummaryDto>(`/accounts/${accountId}/card-summary`),
    enabled: ws !== 'none' && Boolean(accountId),
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
    for (const key of ['budgets', 'goals', 'recurring', 'reminders', 'detector-subscriptions', 'budget-suggestions']) {
      void queryClient.invalidateQueries({ queryKey: [ws, key] });
    }
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
}
