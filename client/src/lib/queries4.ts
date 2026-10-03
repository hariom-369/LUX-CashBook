import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgeingReportDto,
  DayClosingDto,
  GstSummaryDto,
  InvoiceDto,
  InvoiceStatus,
  MonthClosingDto,
  PettyCashDailyReportDto,
  PettyCashDto,
  ProductDto,
  ProfitAndLossDto,
  ProjectDto,
  ProjectStatus,
  ProjectSummaryDto,
  QuotationDto,
  QuotationStatus,
  StockMovementDto,
} from '@khata/shared';
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

// ─────────────────────────────────────────────── Invoicing (Phase 11)

export function useProjects(options: { status?: ProjectStatus } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'projects', options],
    queryFn: () => api.get<ProjectDto[]>('/projects', { query: options }),
    enabled: ws !== 'none',
  });
}

export function useProject(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'projects', id],
    queryFn: () => api.get<ProjectDto>(`/projects/${id}`),
    enabled: ws !== 'none' && Boolean(id),
  });
}

export function useProjectSummary(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'projects', id, 'summary'],
    queryFn: () => api.get<ProjectSummaryDto>(`/projects/${id}/summary`),
    enabled: ws !== 'none' && Boolean(id),
  });
}

export function useInvoices(options: { status?: InvoiceStatus; personId?: string; projectId?: string } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'invoices', options],
    queryFn: () => api.get<InvoiceDto[]>('/invoices', { query: options }),
    enabled: ws !== 'none',
  });
}

export function useInvoice(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'invoices', id],
    queryFn: () => api.get<InvoiceDto>(`/invoices/${id}`),
    enabled: ws !== 'none' && Boolean(id),
  });
}

export function useQuotations(options: { status?: QuotationStatus; personId?: string } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'quotations', options],
    queryFn: () => api.get<QuotationDto[]>('/quotations', { query: options }),
    enabled: ws !== 'none',
  });
}

export function useQuotation(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'quotations', id],
    queryFn: () => api.get<QuotationDto>(`/quotations/${id}`),
    enabled: ws !== 'none' && Boolean(id),
  });
}

export function useInvalidateInvoicing() {
  const queryClient = useQueryClient();
  const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';
  return () => {
    for (const key of ['invoices', 'quotations', 'projects', 'accounts', 'transactions', 'dashboard', 'people']) {
      void queryClient.invalidateQueries({ queryKey: [ws, key] });
    }
  };
}

// ─────────────────────────────────────────────── Business reports (Phase 12)

export function useProfitAndLoss(range: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'profit-and-loss', range],
    queryFn: () => api.get<ProfitAndLossDto>('/reports/profit-and-loss', { query: { range } }),
    enabled: ws !== 'none',
  });
}

export function useAgeingReport(direction: 'receivable' | 'payable') {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'ageing', direction],
    queryFn: () => api.get<AgeingReportDto>('/reports/ageing', { query: { direction } }),
    enabled: ws !== 'none',
  });
}

export function useGstSummary(range: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'gst-summary', range],
    queryFn: () => api.get<GstSummaryDto>('/reports/gst-summary', { query: { range } }),
    enabled: ws !== 'none',
  });
}

export function usePettyCashReport(pettyCashId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'petty-cash', pettyCashId, 'report'],
    queryFn: () => api.get<PettyCashDailyReportDto>(`/petty-cash/${pettyCashId}/report`),
    enabled: ws !== 'none' && Boolean(pettyCashId),
  });
}

// ─────────────────────────────────────────────── Inventory (Phase 12)

export function useProducts(options: { lowStockOnly?: boolean; includeInactive?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'products', options],
    queryFn: () => api.get<ProductDto[]>('/products', { query: options }),
    enabled: ws !== 'none',
  });
}

export function useProduct(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'products', id],
    queryFn: () => api.get<ProductDto>(`/products/${id}`),
    enabled: ws !== 'none' && Boolean(id),
  });
}

export function useStockMovements(productId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [ws, 'products', productId, 'movements'],
    queryFn: () => api.get<StockMovementDto[]>(`/products/${productId}/movements`),
    enabled: ws !== 'none' && Boolean(productId),
  });
}

export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';
  return () => {
    for (const key of ['products']) {
      void queryClient.invalidateQueries({ queryKey: [ws, key] });
    }
  };
}
