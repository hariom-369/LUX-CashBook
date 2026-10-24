import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CashFlowPointDto,
  CategoryRuleDto,
  CategorySuggestionDto,
  ReimbursementSummaryDto,
  ReportDefinition,
  ReportResultDto,
  SavedReportDto,
  TagSummaryDto,
  TrashItemDto,
  TrashItemType,
  Paginated,
  MonthlyInsightsDto,
  UpcomingPaymentsDto,
} from '@khata/shared';
import { api } from './api';
import { useAuthStore } from '../stores/auth.store';

/** Phase 2 and 7 additions: tags, category rules, reimbursements, the report builder. */

function useWorkspaceId(): string {
  return useAuthStore((s) => s.activeWorkspaceId ?? 'none');
}

/** What was spent today - the same 'expense' the dashboard's month figure counts, over the server's own 'today' (§Phase 2 Daily Money). */
export function useTodaySpend() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'today-spend'],
    queryFn: async () => {
      const points = await api.get<CashFlowPointDto[]>('/dashboard/cash-flow', { query: { range: 'today' } });
      return points.reduce((sum, point) => sum + point.expenseMinor, 0);
    },
    enabled: ws !== 'none',
  });
}

export function useTags() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'tags'],
    queryFn: () => api.get<TagSummaryDto[]>('/tags'),
    enabled: ws !== 'none',
  });
}

export function useTagReport(from: string, to: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'tag-report', from, to],
    queryFn: () => api.get<{ rows: TagSummaryDto[]; overlapping: true }>('/tags/report', { query: { from, to } }),
    enabled: ws !== 'none',
  });
}

export function useCategoryRules() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'category-rules'],
    queryFn: () => api.get<CategoryRuleDto[]>('/category-rules'),
    enabled: ws !== 'none',
  });
}

/** One-off lookup used while typing an entry - a suggestion is an offer, so a failure just means "no suggestion". */
export async function fetchCategorySuggestion(input: {
  description?: string;
  payee?: string;
  kind: 'income' | 'expense';
}): Promise<CategorySuggestionDto | null> {
  try {
    return await api.get<CategorySuggestionDto | null>('/category-rules/suggest', { query: input });
  } catch {
    return null;
  }
}

export function useReimbursementSummary() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'reimbursement-summary'],
    queryFn: () => api.get<ReimbursementSummaryDto>('/transactions/reimbursements/summary'),
    enabled: ws !== 'none',
  });
}

export function useSavedReports() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'saved-reports'],
    queryFn: () => api.get<SavedReportDto[]>('/saved-reports'),
    enabled: ws !== 'none',
  });
}

export function runReportDefinition(definition: ReportDefinition): Promise<ReportResultDto> {
  return api.post<ReportResultDto>('/reports/custom', { definition });
}

/** Everything these screens read depends on the ledger, so tag/rule/reimbursement edits refresh the usual suspects. */
export function useInvalidateOrganise() {
  const queryClient = useQueryClient();
  const ws = useWorkspaceId();
  return () => {
    for (const key of ['tags', 'tag-report', 'category-rules', 'reimbursement-summary', 'saved-reports', 'transactions', 'transaction']) {
      void queryClient.invalidateQueries({ queryKey: [ws, key] });
    }
  };
}

// ─────────────────────────────────────────────── Trash (§Trash)

export interface TrashQuery {
  type?: TrashItemType;
  q?: string;
  page?: number;
  limit?: number;
}

/** What's in Trash: newest deletion first, with each item's 30-day countdown. */
export function useTrash(params: TrashQuery) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'trash', params],
    queryFn: () => api.get<Paginated<TrashItemDto>>('/trash', { query: { ...params } }),
    enabled: ws !== 'none',
    placeholderData: (previous) => previous,
  });
}

/**
 * After a restore or permanent delete: a restored record can reappear on almost any screen
 * (a transaction moves balances, reports, budgets and a person's ledger), so everything this
 * workspace has loaded is refreshed rather than guessing which lists it touched.
 */
export function useInvalidateAfterTrash() {
  const queryClient = useQueryClient();
  const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';
  return () => void queryClient.invalidateQueries({ queryKey: [ws] });
}

// ─────────────────────────────────────────────── Monthly insights & upcoming payments

/** One month's facts vs the month before. `month` is YYYY-MM; omitted = this month. */
export function useMonthlyInsights(month: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'monthly-insights', month],
    queryFn: () => api.get<MonthlyInsightsDto>('/reports/monthly-insights', { query: { month } }),
    enabled: ws !== 'none',
    placeholderData: (previous) => previous,
  });
}

/** Everything scheduled in the next `days` days, plus what was paid recently. Read-only. */
export function useUpcomingPayments(days: number) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'upcoming-payments', days],
    queryFn: () => api.get<UpcomingPaymentsDto>('/upcoming', { query: { days } }),
    enabled: ws !== 'none',
    placeholderData: (previous) => previous,
  });
}
