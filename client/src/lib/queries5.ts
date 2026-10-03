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
