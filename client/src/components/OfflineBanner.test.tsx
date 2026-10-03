import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { OfflineBanner as Banner } from './OfflineBanner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './ui/Toast';
import { useOfflineStore } from '../stores/offline.store';
import { useAuthStore } from '../stores/auth.store';
import { hi } from '../i18n/messages/hi';

// ConflictDialog (mounted by the banner) needs the toast and query contexts.
const queryClient = new QueryClient();
const OfflineBanner = () => (
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <Banner />
    </ToastProvider>
  </QueryClientProvider>
);

afterEach(() => {
  cleanup();
  act(() => {
    useOfflineStore.setState({ pendingCount: 0, conflictCount: 0, syncing: false, justSynced: false });
    useAuthStore.setState({ user: null } as never);
  });
});

describe('<OfflineBanner> wording (§Phase 14/15)', () => {
  it('stays hidden while online with nothing to report', () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pluralises the syncing message in English', () => {
    act(() => useOfflineStore.setState({ syncing: true, pendingCount: 1 }));
    const { unmount } = render(<OfflineBanner />);
    expect(screen.getByRole('status').textContent).toContain('Syncing 1 offline entry…');
    unmount();
    act(() => useOfflineStore.setState({ syncing: true, pendingCount: 3 }));
    render(<OfflineBanner />);
    expect(screen.getByRole('status').textContent).toContain('Syncing 3 offline entries…');
  });

  it('shows the needs-attention count with a Review button, in the signed-in language', () => {
    act(() => {
      useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never);
      useOfflineStore.setState({ conflictCount: 2 });
    });
    render(<OfflineBanner />);
    expect(screen.getByRole('status').textContent).toContain('2 ऑफ़लाइन बदलावों पर आपका ध्यान चाहिए');
    expect(screen.getByRole('button', { name: hi['app.review'] })).toBeTruthy();
  });
});
