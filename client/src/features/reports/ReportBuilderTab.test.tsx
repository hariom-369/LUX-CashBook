import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReportResultDto } from '@khata/shared';

let saved: Array<{ id: string; name: string; definition: Record<string, unknown>; updatedAt: string }> = [];
const runReportDefinition = vi.fn();

vi.mock('../../lib/queries5', () => ({
  runReportDefinition: (d: unknown) => runReportDefinition(d),
  useSavedReports: () => ({ data: saved }),
  useInvalidateOrganise: () => () => {},
}));
vi.mock('../../lib/queries', () => ({
  useAccounts: () => ({ data: [{ id: 'a1', name: 'Wallet' }, { id: 'a2', name: 'HDFC' }] }),
  useCategories: () => ({ data: [{ id: 'c1', name: 'Food', isArchived: false }] }),
}));
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
vi.mock('../../lib/download', () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }));

import { api } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { ReportBuilderTab, cleanDefinition, DEFAULT_DEFINITION } from './ReportBuilderTab';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { hi } from '../../i18n/messages/hi';

const result = (over: Partial<ReportResultDto> = {}): ReportResultDto => ({
  definition: { ...DEFAULT_DEFINITION },
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
  rows: [
    { key: 'c1', label: 'Food', incomeMinor: 0, expenseMinor: 80000, netMinor: -80000, count: 2 },
    { key: 'c2', label: 'Travel', incomeMinor: 0, expenseMinor: 200000, netMinor: -200000, count: 1 },
  ],
  totals: { incomeMinor: 0, expenseMinor: 280000, netMinor: -280000, count: 3 },
  overlapping: false,
  truncated: false,
  ...over,
});

function renderTab() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <ReportBuilderTab />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  runReportDefinition.mockResolvedValue(result());
  vi.mocked(api.post).mockResolvedValue({ id: 's1', name: 'Mine', definition: DEFAULT_DEFINITION, updatedAt: '' });
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1' } as never));
});
afterEach(() => {
  cleanup();
  act(() => useAuthStore.setState({ user: null } as never));
});

describe('cleanDefinition', () => {
  it('keeps only what is set, so a definition and its request stay minimal', () => {
    expect(cleanDefinition({ ...DEFAULT_DEFINITION, accountIds: [], tags: undefined, minAmountMinor: 0 })).toEqual({ ...DEFAULT_DEFINITION, minAmountMinor: 0 });
    expect(cleanDefinition({ ...DEFAULT_DEFINITION, accountIds: ['a1'], types: ['expense'] })).toEqual({ ...DEFAULT_DEFINITION, accountIds: ['a1'], types: ['expense'] });
  });
});

describe('<ReportBuilderTab> (§Phase 7)', () => {
  it('runs the default report and shows an exact table with totals', async () => {
    renderTab();
    const table = await screen.findByRole('table', { name: 'Result' });
    expect(within(table).getByRole('rowheader', { name: 'Travel' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'Total' })).toBeTruthy();
    expect(screen.getByText(/3 entries/)).toBeTruthy();
    expect(runReportDefinition).toHaveBeenCalledWith({ range: 'last_3_months', groupBy: 'category', view: 'table' });
  });

  it('re-runs when a filter or the grouping changes, sending only allow-listed choices', async () => {
    renderTab();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'month' } });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'a2' } });
    fireEvent.change(screen.getByLabelText('Entries'), { target: { value: 'expense' } });
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: ' Work ' } });
    await waitFor(() =>
      expect(runReportDefinition).toHaveBeenLastCalledWith({ range: 'last_3_months', groupBy: 'month', view: 'table', accountIds: ['a2'], types: ['expense'], tags: ['work'] }),
    );
  });

  it('shows bars or a summary but always keeps the exact table', async () => {
    renderTab();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Show as'), { target: { value: 'chart' } });
    expect(await screen.findAllByRole('listitem')).not.toHaveLength(0);
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Show as'), { target: { value: 'summary' } });
    expect(await screen.findByText('Largest group')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    // Changing how it is shown never re-runs the query.
    expect(runReportDefinition).toHaveBeenCalledTimes(1);
  });

  it('says so when tag rows overlap, and when results were cut off', async () => {
    runReportDefinition.mockResolvedValue(result({ overlapping: true, truncated: true }));
    renderTab();
    expect(await screen.findByText(/an entry with several tags appears under each/)).toBeTruthy();
    expect(screen.getByText(/first 500 groups/)).toBeTruthy();
  });

  it('shows an empty state with advice when nothing matches', async () => {
    runReportDefinition.mockResolvedValue(result({ rows: [], totals: { incomeMinor: 0, expenseMinor: 0, netMinor: 0, count: 0 } }));
    renderTab();
    expect(await screen.findByText('Nothing matches')).toBeTruthy();
  });

  it('saves the current definition under a name, then offers update / duplicate / delete', async () => {
    renderTab();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    fireEvent.change(await screen.findByLabelText(/Report name/), { target: { value: 'Quarterly food' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/saved-reports', { name: 'Quarterly food', definition: { range: 'last_3_months', groupBy: 'category', view: 'table' } }));
    expect(await screen.findByRole('button', { name: 'Update report' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy();
  });

  it('loads a saved report\'s settings into the form', async () => {
    saved = [{ id: 's1', name: 'By account', definition: { range: 'this_year', groupBy: 'account', view: 'chart', tags: ['work'] }, updatedAt: '' }];
    renderTab();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Saved reports'), { target: { value: 's1' } });
    await waitFor(() => expect((screen.getByLabelText('Group by') as HTMLSelectElement).value).toBe('account'));
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('this_year');
    expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('work');
  });

  it('exports the current definition as a CSV download', async () => {
    renderTab();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith('/reports/custom/export', undefined, { method: 'POST', body: { definition: { range: 'last_3_months', groupBy: 'category', view: 'table' } } }));
  });

  it('is translated', async () => {
    act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: { preferences: { language: 'hi' } } } as never));
    renderTab();
    expect((await screen.findAllByText(hi['builder.title']!)).length).toBeGreaterThan(0);
  });
});
