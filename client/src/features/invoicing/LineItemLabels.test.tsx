import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../lib/queries', () => ({ usePeople: () => ({ data: [] }) }));
vi.mock('../../lib/queries4', () => ({
  useProjects: () => ({ data: [] }),
  useInvalidateInvoicing: () => () => {},
}));
vi.mock('../../hooks/useOfflinePatch', () => ({ useOfflinePatch: () => vi.fn() }));

import { InvoiceFormSheet } from './InvoiceFormSheet';
import { QuotationFormSheet } from './QuotationFormSheet';
import { ToastProvider } from '../../components/ui/Toast';
import { axeViolations } from '../../test/axe';

afterEach(cleanup);

const wrap = (node: React.ReactNode) => <ToastProvider>{node}</ToastProvider>;

describe.each([
  ['invoice', <InvoiceFormSheet open invoice={null} onClose={() => {}} key="i" />],
  ['quotation', <QuotationFormSheet open quotation={null} onClose={() => {}} key="q" />],
])('%s line items (§Phase 16)', (_name, sheet) => {
  it('every field in a line has a name that includes its line number', () => {
    render(wrap(sheet));
    const dialog = screen.getByRole('dialog');
    for (const field of ['Description', 'HSN/SAC code', 'Quantity', 'Rate']) {
      expect(within(dialog).getByLabelText(`${field}, line 1`), field).toBeTruthy();
    }
    expect(within(dialog).getByRole('button', { name: /Remove line 1/i })).toBeTruthy();
  });

  it('a second line gets its own numbered names, so the fields are distinguishable', () => {
    render(wrap(sheet));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Add line/i }));
    expect(within(dialog).getByLabelText('Quantity, line 2')).toBeTruthy();
    expect(within(dialog).getByLabelText('Quantity, line 1')).toBeTruthy();
  });

  it('has no unlabeled form controls according to axe', async () => {
    render(wrap(sheet));
    const violations = await axeViolations(screen.getByRole('dialog'));
    expect(violations.filter((v) => /^(label|select-name|button-name|aria-input-field-name)/.test(v))).toEqual([]);
  });
});
