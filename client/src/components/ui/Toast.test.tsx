import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function Trigger({ run }: { run: (toast: ReturnType<typeof useToast>) => void }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => run(toast)}>
      go
    </button>
  );
}

function show(run: (toast: ReturnType<typeof useToast>) => void) {
  render(
    <ToastProvider>
      <Trigger run={run} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'go' }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('<ToastProvider> live region (§Phase 16)', () => {
  it('announces through one polite live region, which exists before any toast does', () => {
    render(
      <ToastProvider>
        <p>page</p>
      </ToastProvider>,
    );
    const regions = document.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.getAttribute('aria-live')).toBe('polite');
  });

  it('puts each toast inside that region without a second status role (read twice by some screen readers)', () => {
    show((toast) => toast.success('Saved', 'Amount recorded'));
    const region = document.querySelector('[aria-live]')!;
    expect(region.textContent).toContain('Saved');
    expect(region.textContent).toContain('Amount recorded');
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(region.querySelectorAll('[aria-live], [role="alert"]')).toHaveLength(0);
  });

  it('can be dismissed by keyboard-reachable button, and the action runs once', () => {
    const undo = vi.fn();
    show((toast) => toast.undo('Deleted', undo));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Deleted')).toBeNull();
  });

  it('removes a toast on its own after its time, an error later than a success', () => {
    vi.useFakeTimers();
    show((toast) => {
      toast.success('Quick');
      toast.error('Slow');
    });
    expect(screen.getByText('Quick')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Quick')).toBeNull();
    expect(screen.getByText('Slow')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByText('Slow')).toBeNull();
  });
});
