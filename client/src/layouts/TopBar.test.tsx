import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let unread = 0;
vi.mock('../lib/queries3', () => ({
  useNotifications: () => ({ data: { meta: { unreadCount: unread } } }),
}));

import { TopBar } from './TopBar';
import { useUiStore } from '../stores/ui.store';
import { useAuthStore } from '../stores/auth.store';
import { hi } from '../i18n/messages/hi';

const renderBar = (path = '/transactions') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  unread = 0;
  act(() => {
    useUiStore.setState({ privacyMode: false });
    useAuthStore.setState({ user: null } as never);
  });
});

describe('<TopBar> accessibility (§Phase 16)', () => {
  it('shows the page name as plain text, not a second h1 (each page renders its own)', () => {
    renderBar('/transactions');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('Transactions')).toBeTruthy();
  });

  it('translates the page name', () => {
    act(() => useAuthStore.setState({ user: { name: 'A', email: 'a@b.c', preferences: { language: 'hi' } } } as never));
    renderBar('/transactions');
    expect(screen.getByText(hi['nav.transactions']!)).toBeTruthy();
  });

  it('the privacy toggle names its action and flips it, without a redundant pressed state', () => {
    renderBar();
    const hide = screen.getByRole('button', { name: 'Hide amounts' });
    expect(hide.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(hide);
    expect(useUiStore.getState().privacyMode).toBe(true);
    expect(screen.getByRole('button', { name: 'Show amounts' }).hasAttribute('aria-pressed')).toBe(false);
  });

  it('the notification link says how many are unread', () => {
    unread = 3;
    renderBar();
    expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy();
  });

  it('the notification link has a plain name when nothing is unread', () => {
    renderBar();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy();
  });
});
