import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const zero = {
  cashReceiptMinor: 0, cashPaymentMinor: 0, bankReceiptMinor: 0, bankPaymentMinor: 0,
  discountAllowedMinor: 0, discountReceivedMinor: 0, receiptMinor: 0, paymentMinor: 0,
};
const makeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`, date: '2026-10-01T09:00:00.000Z', particulars: `Entry ${i}`, referenceNo: null, isContra: false,
    ...zero, cashPaymentMinor: 100, paymentMinor: 100, balanceMinor: 1_000_000 - (i + 1) * 100,
  }));

let rowCount = 600;
vi.mock('../../lib/queries', () => ({
  useCashBook: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      rows: makeRows(rowCount),
      opening: { totalMinor: 1_000_000 },
      closing: { totalMinor: 1_000_000 - rowCount * 100 },
      totals: { ...zero, cashPaymentMinor: rowCount * 100, paymentMinor: rowCount * 100 },
    },
  }),
}));

import { CashBookPage, CASH_BOOK_PAGE_SIZE } from './CashBookPage';
import { ToastProvider } from '../../components/ui/Toast';

afterEach(cleanup);

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <CashBookPage />
      </ToastProvider>
    </MemoryRouter>,
  );
// The body rows are the entry rows (opening row has colSpan; entries have a "Entry n" cell).
const entryRows = () => screen.getAllByText(/^Entry \d+$/);

describe('<CashBookPage> progressive rendering (§Phase 16, measured need)', () => {
  it('draws one page of entries and says how many there are in total', () => {
    rowCount = 600;
    renderPage();
    expect(entryRows()).toHaveLength(CASH_BOOK_PAGE_SIZE);
    expect(screen.getByRole('status').textContent).toBe(
      `Showing ${CASH_BOOK_PAGE_SIZE} of 600 entries. Totals and the closing balance include every entry.`,
    );
  });

  it('"Show more" adds another page and "Show all" draws everything, then the controls go away', () => {
    rowCount = 600;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: `Show ${CASH_BOOK_PAGE_SIZE} more` }));
    expect(entryRows()).toHaveLength(CASH_BOOK_PAGE_SIZE * 2);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 600' }));
    expect(entryRows()).toHaveLength(600);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
    // Draws 600 rows in jsdom: ~2 s alone, well over the 5 s default when the whole suite runs in parallel.
  }, 30_000);

  it('the last "Show more" only offers what is left', () => {
    rowCount = 300;
    renderPage();
    expect(screen.getByRole('button', { name: 'Show 50 more' })).toBeTruthy();
  });

  it('draws a short period in full with no extra controls', () => {
    rowCount = 40;
    renderPage();
    expect(entryRows()).toHaveLength(40);
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  });

  it('leaves the totals and closing balance on the full data, not the visible slice', () => {
    rowCount = 600;
    renderPage();
    const table = screen.getByRole('table');
    // closing = 1,000,000 − 600 × 100 = 940,000 minor = ₹9,400
    expect(within(table).getAllByText(/9,400/).length).toBeGreaterThan(0);
  });

  it('the table is reachable by keyboard scrolling', () => {
    rowCount = 40;
    renderPage();
    expect(screen.getByRole('region', { name: 'Cash Book' }).getAttribute('tabindex')).toBe('0');
  });
});
