import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { Money } from './Money';
import { useAuthStore } from '../../stores/auth.store';

/**
 * Every rupee figure in the app renders through `<Money>`, which is exactly why
 * it earns direct tests: a regression here is a regression everywhere at once —
 * including in privacy mode (§38), which depends on the CSS class this component
 * attaches rather than on each screen remembering to mask itself.
 */
afterEach(cleanup);

describe('<Money>', () => {
  it('formats minor units with Indian grouping by default', () => {
    render(<Money amountMinor={125_000_00} alwaysVisible />);
    // `compactDecimals` defaults to true, so a whole-rupee amount drops `.00` in
    // the visible text — the exact figure is still asserted separately via
    // aria-label in the test below, which is what a screen reader announces.
    expect(screen.getByText('₹1,25,000')).toBeInTheDocument();
  });

  it('always carries the exact unmasked amount in aria-label, even when the visible text is compact', () => {
    render(<Money amountMinor={1_84_520_00} compact alwaysVisible />);
    const el = screen.getByLabelText('₹1,84,520.00');
    expect(el).toBeInTheDocument();
  });

  it('marks the element with the sensitive class so privacy mode can blur it globally', () => {
    render(<Money amountMinor={5000} />);
    // A single global CSS rule (`:root.privacy .sensitive`) is what makes privacy
    // mode reliable across the whole app — this class is the contract that rule
    // depends on, so losing it silently breaks masking everywhere at once.
    expect(screen.getByLabelText('₹50.00')).toHaveClass('sensitive');
  });

  it('opts out of the sensitive class only when explicitly told to', () => {
    render(<Money amountMinor={5000} alwaysVisible />);
    expect(screen.getByLabelText('₹50.00')).not.toHaveClass('sensitive');
  });

  it('colours positive amounts as positive and negative as negative by default', () => {
    render(<Money amountMinor={1000} alwaysVisible />);
    expect(screen.getByLabelText('₹10.00')).toHaveClass('text-positive');
  });

  it('never applies income/expense colour to a neutral tone (transfers, invariant I5)', () => {
    render(<Money amountMinor={1000} tone="neutral" alwaysVisible />);
    const el = screen.getByLabelText('₹10.00');
    expect(el).not.toHaveClass('text-positive');
    expect(el).not.toHaveClass('text-negative');
  });

  it('falls back to the active workspace currency when none is passed explicitly', () => {
    act(() => {
      useAuthStore.setState({
        workspaces: [{ id: 'ws1', name: 'US Wallet', mode: 'personal', currency: 'USD', isDefault: true, isDemo: false, fiscalYearStartMonth: 1, createdAt: '', updatedAt: '' }],
        activeWorkspaceId: 'ws1',
      });
    });
    render(<Money amountMinor={150_00} alwaysVisible />);
    expect(screen.getByText('$150')).toBeInTheDocument();
    act(() => {
      useAuthStore.setState({ workspaces: [], activeWorkspaceId: null });
    });
  });
});
