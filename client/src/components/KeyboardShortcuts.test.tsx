import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { useAuthStore } from '../stores/auth.store';
import { hi } from '../i18n/messages/hi';

afterEach(() => {
  cleanup();
  act(() => useAuthStore.setState({ user: null } as never));
});

function openHelp() {
  render(<MemoryRouter><KeyboardShortcuts /></MemoryRouter>);
  fireEvent.keyDown(window, { key: '?' });
}

describe('<KeyboardShortcuts> help sheet (§Phase 14/16)', () => {
  it('lists the go-to shortcuts in English by default', () => {
    openHelp();
    expect(screen.getByText('Go to Transactions')).toBeTruthy();
  });

  it('names each destination with the translated navigation label', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    openHelp();
    expect(screen.getByText(hi['app.goTo']!.replace('{label}', hi['nav.transactions']!))).toBeTruthy();
    expect(screen.queryByText(/Transactions/)).toBeNull();
  });
});
