import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { UserDto } from '@khata/shared';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

import { api, ApiRequestError } from '../lib/api';
import { PinLockScreen } from './PinLockScreen';
import { useUiStore } from '../stores/ui.store';
import { useAuthStore } from '../stores/auth.store';

/**
 * Regression for audit finding S-3: the lock screen used to submit as soon as 4
 * digits were entered and clear the input on a miss, so a 5–8 digit PIN (which
 * Settings allows) could never unlock.
 */
const post = vi.mocked(api.post);

function signInWithPinLength(pinLength: number | null) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      name: 'Asha Sharma',
      email: 'asha@example.com',
      emailVerified: true,
      onboardingCompleted: true,
      preferences: { security: { pinEnabled: true, biometricEnabled: false, sessionTimeoutMinutes: 5, pinLength } },
    } as unknown as UserDto,
  });
}

function press(digits: string) {
  for (const digit of digits) fireEvent.click(screen.getByRole('button', { name: digit }));
}

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ unlocked: true });
  act(() => useUiStore.setState({ locked: true }));
});

afterEach(() => {
  cleanup();
  act(() => {
    useUiStore.setState({ locked: false });
    useAuthStore.setState({ user: null });
  });
});

describe('<PinLockScreen>', () => {
  it('waits for all 6 digits of a 6-digit PIN before verifying', async () => {
    signInWithPinLength(6);
    render(<PinLockScreen />);

    press('4829');
    expect(post).not.toHaveBeenCalled();

    await act(async () => press('13'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/pin/verify', { pin: '482913' });
  });

  it('shows one dot per digit of the PIN', () => {
    signInWithPinLength(5);
    const { container } = render(<PinLockScreen />);
    expect(container.querySelectorAll('[role="alert"] > span')).toHaveLength(5);
  });

  it('lets a PIN saved before its length was recorded be confirmed with the Unlock key', async () => {
    signInWithPinLength(null);
    render(<PinLockScreen />);

    const unlock = screen.getByRole('button', { name: 'Unlock' });
    press('482');
    expect(unlock).toBeDisabled();

    press('91');
    expect(post).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(unlock));
    expect(post).toHaveBeenCalledWith('/auth/pin/verify', { pin: '48291' });
  });

  it('shows the lockout message from the server', async () => {
    signInWithPinLength(4);
    post.mockRejectedValueOnce(
      new ApiRequestError(429, {
        code: 'RATE_LIMITED',
        message: 'Too many wrong PINs. Try again in 15 minutes, or sign in with your password.',
      }),
    );
    render(<PinLockScreen />);
    await act(async () => press('0000'));
    expect(screen.getByText(/Too many wrong PINs/)).toBeInTheDocument();
  });
});
