import { useAuthStore } from '../stores/auth.store';
import { DEFAULT_CURRENCY } from '@khata/shared';

/**
 * The currency figures should be rendered in.
 *
 * The active *workspace* is the authority, not the user profile: a user can hold a
 * personal workspace in INR and a business one in AED, and a figure must always be
 * shown in the currency its ledger is actually denominated in. The profile setting
 * only supplies the default for newly created workspaces.
 */
export function useCurrency(): string {
  return useAuthStore((state) => {
    const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return active?.currency ?? state.user?.preferences.currency ?? DEFAULT_CURRENCY;
  });
}
