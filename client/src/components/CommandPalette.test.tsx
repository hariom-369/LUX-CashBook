import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, api: { ...actual.api, get: vi.fn(), getWithMeta: vi.fn() } };
});

import { api } from '../lib/api';
import { CommandPalette } from './CommandPalette';
import { useUiStore } from '../stores/ui.store';

const get = vi.mocked(api.get);
const getWithMeta = vi.mocked(api.getWithMeta);

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

/** Each list endpoint answers with its own data - they must not all return the same array. */
function serve(byPath: Record<string, unknown>) {
  get.mockImplementation(((path: string) => Promise.resolve(byPath[path] ?? [])) as never);
}

// What `GET /transactions` really returns: the envelope's `data` is a Paginated page, not an array.
function pageOf(items: unknown[]) {
  return { data: { items, page: 1, limit: 5, total: items.length, totalPages: 1, hasMore: false } } as never;
}

beforeEach(() => {
  navigate.mockReset();
  get.mockReset().mockResolvedValue([]);
  getWithMeta.mockReset().mockResolvedValue(pageOf([]));
  act(() => useUiStore.setState({ commandPaletteOpen: true }));
});

afterEach(() => {
  cleanup();
  act(() => useUiStore.setState({ commandPaletteOpen: false }));
});

/**
 * Global search (docs/FEATURE_ROADMAP.md Phase 2): typing at least 2 characters
 * searches transactions and people through the same endpoints their own list
 * pages already use, and merges the results into the same keyboard-navigable
 * list as the static navigation/action commands.
 */
describe('<CommandPalette> global search', () => {
  it('does not search on a 1-character query', async () => {
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'a' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(getWithMeta).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('searches transactions and people once the query reaches 2 characters, debounced', async () => {
    getWithMeta.mockResolvedValue(pageOf([
      { id: 't1', type: 'expense', amountMinor: 25000, date: '2026-01-05T00:00:00.000Z', description: 'Lunch with team', categoryName: 'Food' },
    ]));
    serve({ '/people': [{ id: 'p1', name: 'Rahul Sharma', balanceMinor: 50000 }] });

    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'ra' } });

    await waitFor(() => expect(getWithMeta).toHaveBeenCalledWith('/transactions', { query: { search: 'ra', limit: 5 } }));
    expect(get).toHaveBeenCalledWith('/people', { query: { search: 'ra' } });

    expect(await screen.findByText('Lunch with team')).toBeInTheDocument();
    expect(screen.getByText('Rahul Sharma')).toBeInTheDocument();
  });

  it('navigates to the person on selection', async () => {
    serve({ '/people': [{ id: 'p1', name: 'Amit', balanceMinor: -1000 }] });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'am' } });

    const result = await screen.findByText('Amit');
    fireEvent.click(result);
    expect(navigate).toHaveBeenCalledWith('/people/p1');
  });

  it('navigates to the transactions list, pre-filled with the description, on selection', async () => {
    getWithMeta.mockResolvedValue(pageOf([{ id: 't1', type: 'income', amountMinor: 500000, date: '2026-01-01T00:00:00.000Z', description: 'Salary credit', referenceNo: 'REF1' }]));
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'sal' } });

    const result = await screen.findByText('Salary credit');
    fireEvent.click(result);
    expect(navigate).toHaveBeenCalledWith('/transactions?q=Salary%20credit');
  });

  it('cancels a stale search — only the latest query\'s results are shown', async () => {
    let resolveFirst: (v: ReturnType<typeof pageOf>) => void = () => {};
    getWithMeta
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(pageOf([{ id: 't2', type: 'expense', amountMinor: 100, date: '2026-01-01T00:00:00.000Z', description: 'Second query result' }]));

    renderPalette();
    const input = screen.getByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'first' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: 'second' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalledTimes(2));

    expect(await screen.findByText('Second query result')).toBeInTheDocument();

    // The first (slow) request resolves after the second — must not overwrite it.
    await act(async () => {
      resolveFirst(pageOf([{ id: 't1', type: 'expense', amountMinor: 100, date: '2026-01-01T00:00:00.000Z', description: 'First query result' }]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText('First query result')).not.toBeInTheDocument();
    expect(screen.getByText('Second query result')).toBeInTheDocument();
  });

  it('still shows matching static commands (e.g. "Add transaction") alongside live results', async () => {
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'add' } });
    expect(await screen.findByText('Add transaction')).toBeInTheDocument();
  });
});

describe('<CommandPalette> accounts, payees and structured questions (§Phase 2)', () => {
  const accountList = [
    { id: 'a1', name: 'GPay', type: 'upi', icon: 'Smartphone' },
    { id: 'a2', name: 'HDFC Savings', type: 'bank', icon: 'Landmark' },
    { id: 'a3', name: 'ICICI Current', type: 'bank', icon: 'Landmark' },
  ];

  it('finds an account by name and opens its ledger', async () => {
    serve({ '/accounts': accountList });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'hdfc' } });
    const result = await screen.findByText('HDFC Savings');
    fireEvent.click(result);
    expect(navigate).toHaveBeenCalledWith('/accounts/a2');
  });

  it('finds a payee and opens the list filtered to that payee', async () => {
    serve({ '/payees': [{ id: 'py1', name: 'Zomato' }] });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'zom' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/payees', { query: { search: 'zom' } }));
    fireEvent.click(await screen.findByText('Zomato'));
    expect(navigate).toHaveBeenCalledWith('/transactions?payee=py1&payeeName=Zomato');
  });

  it('turns "above ₹5000" into an amount filter on the list and shows what it understood', async () => {
    serve({ '/accounts': accountList });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'above ₹5000' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalledWith('/transactions', { query: { limit: 5, minAmountMinor: 500000 } }));
    const option = await screen.findByRole('option', { name: /See matching entries/ });
    expect(option.textContent).toContain('above');
    fireEvent.click(option);
    expect(navigate).toHaveBeenCalledWith('/transactions?min=500000');
  });

  it('turns "Zomato last 3 months" into a text search over that period', async () => {
    serve({ '/accounts': accountList });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'Zomato last 3 months' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalled());
    const [, args] = getWithMeta.mock.calls.at(-1)!;
    const query = (args as { query: Record<string, unknown> }).query;
    expect(query.search).toBe('Zomato');
    expect(typeof query.from).toBe('string');
    expect(typeof query.to).toBe('string');
    expect(get).toHaveBeenCalledWith('/people', { query: { search: 'Zomato' } });
    fireEvent.click(await screen.findByRole('option', { name: /See matching entries/ }));
    expect(navigate).toHaveBeenCalledWith('/transactions?q=Zomato&range=last_3_months');
  });

  it('turns "UPI expenses" into expenses on the one UPI account', async () => {
    serve({ '/accounts': accountList });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'UPI expenses' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalledWith('/transactions', { query: { limit: 5, types: ['expense'], accountIds: ['a1'] } }));
    // Nothing is left to look up people, payees or accounts by.
    expect(get).not.toHaveBeenCalledWith('/people', expect.anything());
    fireEvent.click(await screen.findByRole('option', { name: /See matching entries/ }));
    expect(navigate).toHaveBeenCalledWith('/transactions?types=expense&account=a1');
  });

  it('does not guess between two accounts of one kind', async () => {
    serve({ '/accounts': accountList });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'bank expenses' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalled());
    const query = (getWithMeta.mock.calls.at(-1)![1] as { query: Record<string, unknown> }).query;
    expect(query.accountIds).toBeUndefined();
    expect(query.types).toEqual(['expense']);
  });

  it('leaves an ordinary search exactly as it was, with no reading shown', async () => {
    serve({ '/accounts': accountList });
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'cash withdrawal' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalledWith('/transactions', { query: { search: 'cash withdrawal', limit: 5 } }));
    expect(screen.queryByRole('option', { name: /See matching entries/ })).toBeNull();
  });

  it('still searches when the account list cannot be loaded', async () => {
    get.mockImplementation(((path: string) => (path === '/accounts' ? Promise.reject(new Error('offline')) : Promise.resolve([]))) as never);
    renderPalette();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'fuel' } });
    await waitFor(() => expect(getWithMeta).toHaveBeenCalledWith('/transactions', { query: { search: 'fuel', limit: 5 } }));
  });
});

/** The palette is an ARIA combobox (§Phase 16): the input stays focused while the active option is announced. */
describe('<CommandPalette> screen-reader semantics', () => {
  it('exposes the input as a combobox that controls a labelled listbox', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    const listbox = screen.getByRole('listbox', { name: 'Command palette' });
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
  });

  it('keeps focus in the input and points aria-activedescendant at the highlighted option', () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    expect(options[1]!.getAttribute('aria-selected')).toBe('true');
    expect(options[0]!.getAttribute('aria-selected')).toBe('false');
  });

  it('options are not extra Tab stops, and each belongs to a labelled group', () => {
    renderPalette();
    for (const option of screen.getAllByRole('option')) {
      expect(option.getAttribute('tabindex')).toBe('-1');
      expect(option.closest('[role="group"]')?.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('announces how many results a query found, politely', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'add' } });
    const status = await screen.findByText(/^\d+ results?$/);
    expect(status.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('reports no active descendant when nothing matches', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzzzqqqq' } });
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'));
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });
});

describe('<CommandPalette> group keys', () => {
  it('renders without a duplicate-key warning when results from the same group are not adjacent', () => {
    // Static results are sorted by match score, so "Go to" and "Actions" entries interleave and each group name recurs.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPalette();
    const input = screen.getByRole('combobox');
    for (const query of ['en', 'ent', 'entry', 'tra', 'add', 'new', 'a', 'e']) fireEvent.change(input, { target: { value: query } });
    const duplicateKey = errors.mock.calls.some((call) => String(call[0]).includes('same key'));
    errors.mockRestore();
    expect(duplicateKey).toBe(false);
  });

  it('keeps one group element per run of results, and a name may repeat between runs', () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'e' } });
    const names = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(0);
    // Adjacent groups never share a name (they would have been merged).
    names.forEach((name, i) => { if (i > 0) expect(name).not.toBe(names[i - 1]); });
  });
});
