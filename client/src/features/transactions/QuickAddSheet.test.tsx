import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../lib/queries', () => ({
  useAccounts: () => ({ data: [{ id: 'a1', name: 'Cash', type: 'cash' }, { id: 'a2', name: 'Bank', type: 'bank' }] }),
  useCategories: () => ({ data: [] }),
  usePayees: () => ({ data: [] }),
  usePeople: () => ({ data: [{ id: 'p1', name: 'Ravi', balanceMinor: 0 }] }),
  useLedgerMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../lib/queries5', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries5')>();
  return { ...actual, useInvalidateOrganise: () => () => {}, fetchCategorySuggestion: vi.fn().mockResolvedValue(null) };
});

import { QuickAddSheet } from './QuickAddSheet';
import { ToastProvider } from '../../components/ui/Toast';
import { useUiStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';
import { hi } from '../../i18n/messages/hi';

function openAs(typeLabel: RegExp) {
  act(() => useUiStore.setState({ quickAddOpen: true }));
  render(
    <ToastProvider>
      <QuickAddSheet />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText(typeLabel));
}

beforeEach(() => {
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: null } as never));
});
afterEach(() => {
  cleanup();
  act(() => {
    useUiStore.setState({ quickAddOpen: false });
    useAuthStore.setState({ user: null } as never);
  });
});

describe('<QuickAddSheet> save button (§Phase 16)', () => {
  it('is disabled until the amount is entered, and says what is missing', () => {
    openAs(/Money Out|Expense/);
    const save = screen.getByRole('button', { name: /Save expense/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    const hint = screen.getByText('To save, fill in: Amount.');
    expect(save.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('drops the hint and enables the button once the entry is valid', () => {
    openAs(/Money Out|Expense/);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '250' } });
    const save = screen.getByRole('button', { name: /Save expense/i });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(save.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByText(/To save, fill in/)).toBeNull();
  });

  it('names the person too when the entry is a loan', () => {
    openAs(/^Lent$/);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '500' } });
    expect(screen.getByText('To save, fill in: Person.')).toBeTruthy();
  });

  it('is translated', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    openAs(new RegExp(hi['quickAdd.type.expense.label'] ?? 'Money Out'));
    expect(screen.getByText(hi['quickAdd.needsToSave']!.replace('{fields}', hi['reminders.form.amount']!))).toBeTruthy();
  });
});

describe('<QuickAddSheet> typed entry reads accounts and asks about the rest (§Phase 2)', () => {
  function typeIt(text: string) {
    const go = useAuthStore.getState().user ? hi['transactions.go']! : 'Go';
    act(() => useUiStore.setState({ quickAddOpen: true }));
    render(
      <ToastProvider>
        <QuickAddSheet />
      </ToastProvider>,
    );
    fireEvent.change(document.getElementById('nl-quick-entry')!, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: go }));
  }

  it('selects the account it was told about and does not ask for it', () => {
    typeIt('Paid 250 for lunch from Bank');
    expect((screen.getByLabelText(/^Account/) as HTMLSelectElement).value).toBe('a2');
    expect(screen.queryByText('Which account did you use?')).toBeNull();
  });

  it('asks which account when the sentence did not say, until one is chosen', () => {
    typeIt('Paid 250 for lunch');
    expect(screen.getByText('Which account did you use?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Account/), { target: { value: 'a2' } });
    expect(screen.queryByText('Which account did you use?')).toBeNull();
  });

  it('asks who it was with for a loan, and stops asking once a person is picked', () => {
    typeIt('Meena owes me 400');
    expect(screen.getByText('Who was this with?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Given to/), { target: { value: 'p1' } });
    expect(screen.queryByText('Who was this with?')).toBeNull();
  });

  it('prefills both ends of a transfer', () => {
    typeIt('Transferred 5000 from Bank to Cash');
    expect((screen.getByLabelText(/From account/) as HTMLSelectElement).value).toBe('a2');
    expect((screen.getByLabelText(/To account/) as HTMLSelectElement).value).toBe('a1');
  });

  it('shows the questions in Hindi', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    typeIt('Paid 250 for lunch');
    expect(screen.getByText(hi['transactions.question.account']!)).toBeTruthy();
  });
});
