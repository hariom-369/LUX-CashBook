import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type {
  AccountDto,
  CashBookDto,
  CategoryDto,
  DashboardDto,
  Paginated,
  PersonDto,
  PersonLedgerDto,
  RangePreset,
  TransactionDto,
  TransactionListMeta,
} from '@khata/shared';
import { api } from './api';
import { useAuthStore } from '../stores/auth.store';

/**
 * Server state.
 *
 * Every key is prefixed with the workspace id. A workspace switch therefore
 * produces entirely different keys, and no cached figure from a personal ledger can
 * ever be rendered while a business workspace is active — which on a financial
 * screen is the difference between a stale number and a wrong one.
 */
export const queryKeys = {
  dashboard: (ws: string, range: string) => [ws, 'dashboard', range] as const,
  accounts: (ws: string, includeInactive = false) => [ws, 'accounts', { includeInactive }] as const,
  account: (ws: string, id: string) => [ws, 'account', id] as const,
  accountLedger: (ws: string, id: string, params: unknown) => [ws, 'account-ledger', id, params] as const,
  categories: (ws: string, kind?: string) => [ws, 'categories', kind ?? 'all'] as const,
  people: (ws: string, params: unknown) => [ws, 'people', params] as const,
  person: (ws: string, id: string) => [ws, 'person', id] as const,
  personLedger: (ws: string, id: string) => [ws, 'person-ledger', id] as const,
  peopleSummary: (ws: string) => [ws, 'people-summary'] as const,
  transactions: (ws: string, params: unknown) => [ws, 'transactions', params] as const,
  transaction: (ws: string, id: string) => [ws, 'transaction', id] as const,
  cashBook: (ws: string, params: unknown) => [ws, 'cash-book', params] as const,
  integrity: (ws: string) => [ws, 'integrity'] as const,
};

function useWorkspaceId(): string {
  return useAuthStore((s) => s.activeWorkspaceId ?? 'none');
}

// ─────────────────────────────────────────────── Reads

export function useDashboard(range: RangePreset = 'last_30_days') {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.dashboard(ws, range),
    queryFn: () => api.get<DashboardDto>('/dashboard', { query: { cashFlowRange: range } }),
    enabled: ws !== 'none',
  });
}

export function useAccounts(includeInactive = false) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.accounts(ws, includeInactive),
    queryFn: () => api.get<AccountDto[]>('/accounts', { query: { includeInactive } }),
    enabled: ws !== 'none',
    // Accounts change rarely and are read by nearly every screen.
    staleTime: 60_000,
  });
}

export function useAccount(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.account(ws, id ?? ''),
    queryFn: () => api.get<AccountDto>(`/accounts/${id}`),
    enabled: Boolean(id) && ws !== 'none',
  });
}

export interface AccountLedgerResponse {
  account: AccountDto;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  rows: Array<{
    id: string;
    date: string;
    description: string;
    type: string;
    referenceNo?: string;
    amountMinor: number;
    balanceMinor: number;
    categoryName?: string;
    personName?: string;
    counterAccountName?: string;
    isContra: boolean;
  }>;
  total: number;
}

export function useAccountLedger(id: string | undefined, params: { from?: string; to?: string; page?: number } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.accountLedger(ws, id ?? '', params),
    queryFn: () => api.get<AccountLedgerResponse>(`/accounts/${id}/ledger`, { query: params }),
    enabled: Boolean(id) && ws !== 'none',
  });
}

export function useCategories(kind?: 'income' | 'expense') {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.categories(ws, kind),
    queryFn: () => api.get<CategoryDto[]>('/categories', { query: { kind } }),
    enabled: ws !== 'none',
    staleTime: 5 * 60_000,
  });
}

export interface PeopleParams {
  search?: string;
  status?: 'receivable' | 'payable' | 'settled' | 'all';
  relationship?: string;
  sortBy?: 'name' | 'balance' | 'recent';
  includeArchived?: boolean;
}

export function usePeople(params: PeopleParams = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.people(ws, params),
    queryFn: () => api.get<PersonDto[]>('/people', { query: params as Record<string, string> }),
    enabled: ws !== 'none',
  });
}

export function usePerson(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.person(ws, id ?? ''),
    queryFn: () => api.get<PersonDto>(`/people/${id}`),
    enabled: Boolean(id) && ws !== 'none',
  });
}

export function usePersonLedger(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.personLedger(ws, id ?? ''),
    queryFn: () => api.get<PersonLedgerDto>(`/people/${id}/ledger`),
    enabled: Boolean(id) && ws !== 'none',
  });
}

export interface TransactionParams {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  types?: string[];
  accountIds?: string[];
  categoryIds?: string[];
  personIds?: string[];
  tags?: string[];
  minAmountMinor?: number;
  maxAmountMinor?: number;
  search?: string;
  sortBy?: 'date' | 'amount' | 'created';
  sortOrder?: 'asc' | 'desc';
  onlyDeleted?: boolean;
  outstandingOnly?: boolean;
}

/**
 * The list endpoint returns the filtered income/expense totals in `meta`, so the
 * page and its summary arrive in one round trip. `placeholderData` keeps the
 * previous page on screen while the next one loads, instead of flashing a skeleton
 * every time a filter changes.
 */
export function useTransactions(params: TransactionParams = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.transactions(ws, params),
    queryFn: async () => {
      const envelope = await api.getWithMeta<Paginated<TransactionDto>>('/transactions', {
        query: params as never,
      });
      return {
        page: envelope.data,
        totals: (envelope.meta ?? {}) as unknown as TransactionListMeta,
      };
    },
    enabled: ws !== 'none',
    placeholderData: (previous) => previous,
  });
}

export function useTransaction(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.transaction(ws, id ?? ''),
    queryFn: () => api.get<TransactionDto>(`/transactions/${id}`),
    enabled: Boolean(id) && ws !== 'none',
  });
}

export function useCashBook(params: { view: 'single' | 'double' | 'triple'; from: string; to: string }) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.cashBook(ws, params),
    queryFn: () => api.get<CashBookDto>('/cash-book', { query: params }),
    enabled: ws !== 'none',
  });
}

export interface IntegrityReport {
  ok: boolean;
  checked: { accounts: number; people: number; transactions: number };
  issues: Array<{
    kind: string;
    id: string;
    name: string;
    expectedMinor?: number;
    actualMinor?: number;
    detail?: string;
  }>;
}

export function useIntegrity(enabled = false) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.integrity(ws),
    queryFn: () => api.get<IntegrityReport>('/integrity'),
    enabled: enabled && ws !== 'none',
  });
}

// ─────────────────────────────────────────────── Writes

/**
 * Invalidate everything a money movement could have changed.
 *
 * Deliberately broad: a single transaction can affect balances, the dashboard, a
 * person's ledger, the cash book and the integrity report. Being surgical here
 * would save a few requests and risk showing a figure that is quietly out of date,
 * which is the wrong trade in a ledger.
 */
export function useInvalidateLedger() {
  const queryClient = useQueryClient();
  const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';

  return () => {
    for (const key of ['dashboard', 'accounts', 'account', 'account-ledger', 'transactions', 'transaction', 'people', 'person', 'person-ledger', 'people-summary', 'cash-book', 'integrity']) {
      void queryClient.invalidateQueries({ queryKey: [ws, key] });
    }
  };
}

export function useLedgerMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'>,
) {
  const invalidate = useInvalidateLedger();
  return useMutation<TData, Error, TVariables>({
    mutationFn,
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export type { UseQueryOptions };
