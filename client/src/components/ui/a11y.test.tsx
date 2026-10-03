import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Field, Input, Select } from './Input';
import { EmptyState, ErrorState } from './States';
import { BalanceHeader, MonthSummary } from '../../features/dashboard/DashboardPage';
import { NotFoundPage } from '../../features/NotFoundPage';
import { axeViolations } from '../../test/axe';
import { ChartTextAlternative } from './ChartTextAlternative';
import { ScrollRegion } from './ScrollRegion';
import { NetWorthChart } from '../../features/reports/NetWorthChart';
import { ForecastChart } from '../../features/reports/ForecastChart';
import { useUiStore } from '../../stores/ui.store';

afterEach(cleanup);

describe('structural accessibility (§Phase 16)', () => {
  it('a required field tells a screen reader it is required, not only sighted users', () => {
    render(
      <Field label="Amount" required>
        {({ id }) => <Input id={id} />}
      </Field>,
    );
    expect(screen.getByLabelText(/Amount/).id).toBeTruthy();
    expect(screen.getByText(/\(required\)/).className).toContain('sr-only');
  });

  it('links a field error to its input and announces it', async () => {
    const { container } = render(
      <Field label="Name" error="Enter a name">
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} />}
      </Field>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Enter a name');
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('empty and error states head their section with an h2, never skipping from h1 to h3', () => {
    render(<EmptyState title="Nothing here" />);
    render(<ErrorState error={new Error("Boom")} />);
    const levels = screen.getAllByRole('heading').map((h) => h.tagName);
    expect(levels).toEqual(['H2', 'H2']);
  });

  it('a Select needs a name — an unlabelled one is flagged, a labelled one passes', async () => {
    const bad = render(
      <Select>
        <option>One</option>
      </Select>,
    );
    expect(await axeViolations(bad.container)).toEqual([expect.stringContaining('select-name')]);
    bad.unmount();
    const good = render(
      <Select aria-label="Status">
        <option>One</option>
      </Select>,
    );
    expect(await axeViolations(good.container)).toEqual([]);
  });

  it('negative control: axe does flag a row nested two divs deep inside a <dl> (the old dashboard markup)', async () => {
    const { container } = render(
      <dl>
        <div>
          <div>
            <dt>Net</dt>
            <dd>1</dd>
          </div>
        </div>
      </dl>,
    );
    expect((await axeViolations(container)).join(' ')).toMatch(/definition-list|dlitem/);
  });

  it("the dashboard's month summary is valid description-list markup", async () => {
    const { container } = render(
      <MonthSummary
        month={{
          label: 'October 2026',
          incomeMinor: 900000,
          expenseMinor: 145000,
          netSavingsMinor: 755000,
          savingsRate: 83.9,
          previousIncomeMinor: 0,
          previousExpenseMinor: 100000,
        }}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    // Every <dt>/<dd> sits in a <dl> (directly or through one wrapper div).
    for (const el of container.querySelectorAll('dt, dd')) {
      expect(el.closest('dl'), el.textContent ?? '').not.toBeNull();
    }
  });
});

describe('chart text alternatives (§Phase 16)', () => {
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('ChartTextAlternative is a real, labelled table that is visually hidden', async () => {
    const { container } = render(
      <ChartTextAlternative caption="Net worth trend" columns={['Date', 'Net worth']} rows={[['Jan 2026', '₹1,00,000'], ['Feb 2026', '₹1,10,000']]} />,
    );
    expect(screen.getByRole('table', { name: 'Net worth trend' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('rowheader', { name: 'Feb 2026' })).toBeTruthy();
    expect(container.querySelector('table')?.className).toContain('sr-only');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('NetWorthChart hides the picture from assistive tech and exposes the points as a table', () => {
    const { container } = render(<NetWorthChart history={[{ date: '2026-01-31', netWorthMinor: 10000000 }, { date: '2026-02-28', netWorthMinor: 11000000 }]} />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('table', { name: 'Net worth trend' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Feb 2026' })).toBeTruthy();
  });

  it('ForecastChart exposes its projected balances as a table', () => {
    render(<ForecastChart points={[{ date: '2026-11-01', projectedBalanceMinor: 500000 }]} />);
    expect(screen.getByRole('table', { name: 'Cash-flow forecast' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Projected balance (estimate)' })).toBeTruthy();
  });

  it('the table masks amounts in privacy mode, exactly like the chart', () => {
    act(() => useUiStore.setState({ privacyMode: true }));
    render(<NetWorthChart history={[{ date: '2026-01-31', netWorthMinor: 10000000 }]} />);
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['••••']);
    act(() => useUiStore.setState({ privacyMode: false }));
  });
});

describe('headings and toggle semantics (§Phase 16)', () => {
  it('the dashboard greeting is the page\'s h1, so the page has one on a phone where the top-bar label is hidden', () => {
    render(<BalanceHeader greeting="Good morning, Asha" totalMinor={100000} netWorthMinor={100000} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Good morning, Asha' })).toBeTruthy();
  });

  it('the privacy toggle names its action and does not also claim a pressed state', () => {
    act(() => useUiStore.setState({ privacyMode: false }));
    render(<BalanceHeader greeting="Hi" totalMinor={0} netWorthMinor={0} />);
    const button = screen.getByRole('button', { name: 'Hide amounts' });
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(button);
    const after = screen.getByRole('button', { name: 'Show amounts' });
    expect(after.hasAttribute('aria-pressed')).toBe(false);
    act(() => useUiStore.setState({ privacyMode: false }));
  });

  it('the 404 page is headed by an h1', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: "That page doesn't exist" })).toBeTruthy();
  });

  it('EmptyState defaults to h2 and can be an h1', () => {
    const { rerender } = render(<EmptyState title="A" />);
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    rerender(<EmptyState title="A" titleAs="h1" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
});

describe('page-level states and scroll regions (§Phase 16)', () => {
  it('an ErrorState that replaces a whole page is an h1; by default it is an h2', () => {
    const { rerender } = render(<ErrorState error={new Error('x')} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    rerender(<ErrorState error={new Error('x')} titleAs="h1" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('ScrollRegion is a labelled, focusable region so a keyboard can scroll it', async () => {
    const { container } = render(
      <ScrollRegion label="Ledger">
        <table><caption>c</caption><thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
      </ScrollRegion>,
    );
    const region = screen.getByRole('region', { name: 'Ledger' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('overflow-x-auto');
    expect(await axeViolations(container)).toEqual([]);
  });
});
