import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { RouteAnnouncer } from './RouteAnnouncer';
import { useAuthStore } from '../stores/auth.store';
import { hi } from '../i18n/messages/hi';

let go: (to: string) => void = () => {};
function Harness() {
  const navigate = useNavigate();
  go = navigate;
  return <RouteAnnouncer />;
}
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  document.title = '';
  act(() => useAuthStore.setState({ user: null } as never));
});

describe('<RouteAnnouncer> (§Phase 16)', () => {
  it('sets the document title on load but does not announce the initial page', () => {
    renderAt('/transactions');
    expect(document.title).toBe('Transactions · Khata');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('updates the title and announces the new page after a navigation', () => {
    renderAt('/');
    expect(document.title).toBe('Dashboard · Khata');
    act(() => go('/settings/security'));
    expect(document.title).toBe('Security · Settings · Khata');
    expect(screen.getByRole('status').textContent).toBe('Settings — Security');
  });

  it('uses a polite live region so it never interrupts', () => {
    renderAt('/');
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
  });

  it('speaks the signed-in language', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    renderAt('/');
    expect(document.title).toBe(`${hi['nav.dashboard']} · Khata`);
  });

  it('announces a missing page as not found', () => {
    renderAt('/');
    act(() => go('/definitely-not-a-page'));
    expect(screen.getByRole('status').textContent).toBe("That page doesn't exist");
  });
});
