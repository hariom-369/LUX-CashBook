import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TransactionDto } from '@khata/shared';
import { TransactionRow } from './TransactionRow';
import { useAuthStore } from '../../stores/auth.store';
import { hi } from '../../i18n/messages/hi';
import { axeViolations } from '../../test/axe';

afterEach(cleanup);

const txn = {
  id: 't1', type: 'expense', amountMinor: 5000, currency: 'INR', date: new Date().toISOString(),
  description: 'Chai', tags: [], attachments: [], postings: [], accountName: 'Cash',
} as unknown as TransactionDto;

describe('<TransactionRow> bulk selection (§Phase 16)', () => {
  it('toggles instead of opening the detail when in selection mode', () => {
    const open = vi.fn();
    const toggle = vi.fn();
    render(<ul><TransactionRow transaction={txn} onClick={open} selection={{ checked: false, onToggle: toggle }} /></ul>);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(toggle).toHaveBeenCalledWith(txn);
    expect(open).not.toHaveBeenCalled();
  });

  it('reflects the checked state', () => {
    render(<ul><TransactionRow transaction={txn} selection={{ checked: true, onToggle: vi.fn() }} /></ul>);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
  });

  it('is a checkbox that contains no other control, and has no state when not selecting', async () => {
    const { container } = render(<ul><TransactionRow transaction={txn} selection={{ checked: false, onToggle: vi.fn() }} /></ul>);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(container.querySelectorAll('input, button button, [role="checkbox"] [tabindex]')).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens the detail normally outside selection mode', () => {
    const open = vi.fn();
    render(<ul><TransactionRow transaction={txn} onClick={open} /></ul>);
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalledWith(txn);
  });
});

describe('<TransactionRow> language (§Phase 14)', () => {
  const noDescription = { ...txn, description: '' } as unknown as TransactionDto;

  it('labels a description-less entry in the signed-in language', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    render(<ul><TransactionRow transaction={noDescription} /></ul>);
    expect(screen.getByText(hi['txType.expense']!)).toBeTruthy();
    act(() => useAuthStore.setState({ user: null } as never));
  });

  it('keeps the English label when no language is set', () => {
    render(<ul><TransactionRow transaction={noDescription} /></ul>);
    expect(screen.getByText('Expense')).toBeTruthy();
  });
});

describe('<TransactionRow> masked entry (§Phase 9)', () => {
  const masked = {
    ...txn,
    type: 'transfer',
    description: 'Transfer with a private account',
    isMasked: true,
    fromAccountId: 'a1',
    toAccountId: undefined,
    postings: [{ accountId: 'a1', accountName: 'Cash', amountMinor: -5000 }],
  } as unknown as TransactionDto;

  it('names only the shared account, says the other side is private, and cannot be opened or selected', () => {
    const open = vi.fn();
    render(<ul><TransactionRow transaction={masked} onClick={open} selection={{ checked: false, onToggle: vi.fn() }} /></ul>);
    expect(screen.getByText('Transfer with a private account')).toBeTruthy();
    expect(screen.getByText(/Private account/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('is translated', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    render(<ul><TransactionRow transaction={masked} /></ul>);
    expect(screen.getByText(hi['transactions.privateTransfer']!)).toBeTruthy();
    act(() => useAuthStore.setState({ user: null } as never));
  });
});
