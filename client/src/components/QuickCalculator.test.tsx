import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from './ui/Toast';
import { QuickCalculator } from './QuickCalculator';
import { useAuthStore } from '../stores/auth.store';

function renderCalculator(onClose = vi.fn(), open = true) {
  render(
    <ToastProvider>
      <QuickCalculator open={open} onClose={onClose} />
    </ToastProvider>,
  );
  return onClose;
}

/** Keys as the user types them, delivered the way the browser does — to the focused element. */
function typeKeys(keys: string[]) {
  for (const key of keys) fireEvent.keyDown(document.activeElement ?? document.body, { key });
}
const result = () => screen.getByLabelText('Result').textContent;
const expression = () => screen.getByLabelText('Calculation').textContent;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  localStorage.clear();
  act(() => useAuthStore.setState({ activeWorkspaceId: null, workspaces: [], user: null } as never));
});
afterEach(() => cleanup());

describe('<QuickCalculator> keyboard', () => {
  it('shows the answer as you type, and calculates on Enter with the usual precedence', () => {
    renderCalculator();
    typeKeys(['1', '2', '+', '3', '*', '2']);
    expect(expression()).toBe('12+3×2');
    expect(result()).toBe('18');

    typeKeys(['Enter']);
    expect(expression()).toBe('12+3×2 =');
    expect(result()).toBe('18');
  });

  it('closes on Escape', () => {
    const onClose = renderCalculator();
    typeKeys(['Escape']);
    expect(onClose).toHaveBeenCalled();
  });

  it('edits with Backspace, clears with C or Delete, and accepts = and x', () => {
    renderCalculator();
    typeKeys(['9', '8', 'Backspace', 'x', '3', '=']);
    expect(result()).toBe('27');

    typeKeys(['c']);
    expect(result()).toBe('0');
    typeKeys(['5', 'Delete']);
    expect(result()).toBe('0');
  });

  it('carries on from an answer with an operator, and starts afresh with a digit', () => {
    renderCalculator();
    typeKeys(['1', '0', '0', 'Enter', '+', '1', '8', '%', 'Enter']);
    expect(result()).toBe('118');
    typeKeys(['7']);
    expect(result()).toBe('7');
  });

  it('works out a decimal sum exactly', () => {
    renderCalculator();
    typeKeys(['0', '.', '1', '+', '0', '.', '2', 'Enter']);
    expect(result()).toBe('0.3');
  });

  it('explains division by zero and an incomplete sum instead of showing a wrong number', () => {
    renderCalculator();
    typeKeys(['5', '/', '0', 'Enter']);
    expect(screen.getByRole('alert').textContent).toBe('You can’t divide by zero.');

    typeKeys(['c', '5', '+', 'Enter']);
    expect(screen.getByRole('alert').textContent).toBe('That calculation isn’t complete.');
  });

  it('ignores the keyboard while closed', () => {
    renderCalculator(vi.fn(), false);
    typeKeys(['5']);
    expect(screen.queryByLabelText('Result')).toBeNull();
  });
});

describe('<QuickCalculator> keypad, memory and copy', () => {
  it('calculates from the on-screen keys, including brackets and percent', () => {
    renderCalculator();
    for (const name of ['Open bracket', '2', 'Add', '3', 'Close bracket', 'Multiply', '2', '0', '0', 'Percent', 'Calculate']) click(name);
    expect(result()).toBe('10');
  });

  it('flips the sign of the number being typed', () => {
    renderCalculator();
    for (const name of ['8', 'Change sign']) click(name);
    expect(expression()).toBe('−8');
    for (const name of ['Add', '3', 'Change sign', 'Calculate']) click(name);
    expect(result()).toBe('-11');
  });

  it('stores, adds to and recalls the memory', () => {
    renderCalculator();
    expect((screen.getByRole('button', { name: 'Memory recall' }) as HTMLButtonElement).disabled).toBe(true);

    typeKeys(['5', '0']);
    click('Memory store');
    typeKeys(['c', '2', '5']);
    click('Memory add'); // memory: 75
    typeKeys(['c', '1', '0', '+']);
    click('Memory recall');
    typeKeys(['Enter']);
    expect(result()).toBe('85');

    click('Memory clear');
    expect((screen.getByRole('button', { name: 'Memory recall' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('groups large answers in the currency style', () => {
    renderCalculator();
    typeKeys(['1', '2', '3', '4', '5', '6', '7', '*', '1', '0', 'Enter']);
    expect(result()).toBe('1,23,45,670');
  });

  it('copies the plain answer, from the button and with Ctrl+C', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCalculator();

    expect((screen.getByRole('button', { name: 'Copy result' }) as HTMLButtonElement).disabled).toBe(true);
    typeKeys(['1', '2', '3', '4', '5', '*', '2', 'Enter']);
    click('Copy result');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('24690'));

    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(result()).toBe('24,690'); // Ctrl+C copies; it does not clear
  });
});

describe('<QuickCalculator> history', () => {
  it('keeps worked-out sums in this browser, reuses them, and clears them', () => {
    renderCalculator();
    expect(screen.getByText('Your calculations will appear here.')).toBeTruthy();

    typeKeys(['2', '5', '0', '+', '1', '2', '5', 'Enter']);
    const history = within(screen.getByRole('region', { name: 'History' }));
    expect(history.getByText('250+125')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('khata.calculatorHistory.guest')!)[0]).toMatchObject({ expression: '250+125', value: '375' });

    // Still there next time it opens.
    cleanup();
    renderCalculator();
    typeKeys(['9']);
    click('Use 375');
    expect(result()).toBe('375');
    typeKeys(['*', '2', 'Enter']);
    expect(result()).toBe('750');

    click('Clear history');
    expect(localStorage.getItem('khata.calculatorHistory.guest')).toBeNull();
    expect(screen.getByText('Your calculations will appear here.')).toBeTruthy();
  });

  it('keeps each user\'s history separate', () => {
    act(() => useAuthStore.setState({ user: { id: 'u1', preferences: {} } } as never));
    renderCalculator();
    typeKeys(['1', '+', '1', 'Enter']);
    expect(localStorage.getItem('khata.calculatorHistory.u1')).toContain('"value":"2"');
    expect(localStorage.getItem('khata.calculatorHistory.guest')).toBeNull();
  });
});

describe('<QuickCalculator> percentage tools', () => {
  it('works out a percentage of an amount, and GST added or included', () => {
    renderCalculator();
    fireEvent.click(screen.getByRole('tab', { name: 'Percentage' }));

    const [percent] = screen.getAllByLabelText('Percent');
    const [ofAmount, taxAmount] = screen.getAllByLabelText('Amount');
    fireEvent.change(percent!, { target: { value: '18' } });
    fireEvent.change(ofAmount!, { target: { value: '499' } });
    expect(screen.getByRole('button', { name: 'Copy 89.82' })).toBeTruthy();

    fireEvent.change(taxAmount!, { target: { value: '1180' } }); // rate defaults to 18%
    expect(screen.getByRole('button', { name: 'Copy 1,392.40' })).toBeTruthy(); // with 18% added
    expect(screen.getByRole('button', { name: 'Copy 1,000.00' })).toBeTruthy(); // 1,180 already includes 18%
  });

  it('takes typed digits into its fields rather than the keypad, and reports division by zero', () => {
    renderCalculator();
    fireEvent.click(screen.getByRole('tab', { name: 'Percentage' }));
    const part = screen.getByLabelText('Part');
    const total = screen.getByLabelText('Total');
    fireEvent.change(part, { target: { value: '5' } });
    fireEvent.change(total, { target: { value: '0' } });
    expect(screen.getByText('You can’t divide by zero.')).toBeTruthy();

    fireEvent.change(total, { target: { value: '20' } });
    expect(screen.getByRole('button', { name: 'Copy 25%' })).toBeTruthy();
  });
});
