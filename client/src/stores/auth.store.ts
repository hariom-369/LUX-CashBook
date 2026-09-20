import { create } from 'zustand';
import type { AuthSessionDto, UserDto, WorkspaceDto } from '@khata/shared';
import {
  ApiRequestError,
  api,
  setAccessToken,
  setActiveWorkspaceId,
  setSessionLostHandler,
  setSessionRestoredHandler,
} from '../lib/api';
import { cacheGet, cacheSet } from '../lib/offlineDb';

const SESSION_CACHE_KEY = 'last-known-session';

interface CachedSession {
  user: UserDto;
  workspaces: WorkspaceDto[];
  activeWorkspaceId: string | null;
}

/**
 * Session state.
 *
 * Note what is *not* here: the access token. It lives inside `lib/api.ts` in a
 * closure, deliberately out of reach of both the React tree and any devtools
 * bridge. The store holds only what the UI needs to render — who is signed in and
 * which workspaces they own.
 *
 * `status` distinguishes "we haven't checked yet" from "definitely signed out", so
 * a reload shows a splash instead of briefly flashing the login screen at someone
 * who is already authenticated.
 */
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: UserDto | null;
  workspaces: WorkspaceDto[];
  activeWorkspaceId: string | null;
  /**
   * True when `status === 'authenticated'` only because a cached session was
   * restored while the refresh endpoint was unreachable (§39) — the access token
   * is stale or absent, so reads may work (served from the service worker's HTTP
   * cache) but writes will queue in the offline outbox rather than succeed.
   */
  isOfflineSession: boolean;

  applySession: (session: AuthSessionDto) => void;
  /** Restore a session on page load using the httpOnly refresh cookie. */
  bootstrap: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: UserDto) => void;
  setWorkspaces: (workspaces: WorkspaceDto[]) => void;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  workspaces: [],
  activeWorkspaceId: null,
  isOfflineSession: false,

  applySession(session) {
    setAccessToken(session.accessToken);
    setActiveWorkspaceId(session.activeWorkspaceId);
    set({
      status: 'authenticated',
      user: session.user,
      workspaces: session.workspaces,
      activeWorkspaceId: session.activeWorkspaceId,
      isOfflineSession: false,
    });
    // The store subscription below persists this to the offline cache — see its
    // comment for why that happens in one place rather than at every call site.
  },

  async bootstrap() {
    set({ status: 'loading' });
    try {
      // Exchanges the refresh cookie for a fresh access token. A 401 here simply
      // means "not signed in" and is an expected outcome, not an error.
      const session = await api.post<AuthSessionDto>('/auth/refresh', undefined, {
        skipAuth: true,
        skipRefresh: true,
      });
      get().applySession(session);
    } catch (err) {
      // A network failure is not the same claim as "you are signed out" — the
      // difference matters enormously here, because treating them the same
      // would sign a user out of their own device the moment they lose signal,
      // which is the exact opposite of what §39 asks for. Only an explicit
      // rejection from a server we actually reached clears the session; an
      // unreachable server falls back to the last session we know was good, so
      // the app keeps rendering from the service worker's cached GETs instead of
      // bouncing to a login screen with nothing to show.
      const offline = err instanceof ApiRequestError && err.isOffline;
      const cached = offline ? await cacheGet<CachedSession>(SESSION_CACHE_KEY) : null;

      if (cached) {
        setActiveWorkspaceId(cached.activeWorkspaceId);
        set({
          status: 'authenticated',
          user: cached.user,
          workspaces: cached.workspaces,
          activeWorkspaceId: cached.activeWorkspaceId,
          isOfflineSession: true,
        });
      } else {
        get().clear();
      }
    }
  },

  async signOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the call fails, the local session must go.
    }
    get().clear();
  },

  setUser: (user) => set({ user }),
  setWorkspaces: (workspaces) => set({ workspaces }),

  async switchWorkspace(workspaceId) {
    const workspace = get().workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return;

    // Set the header first so any request racing this switch is already scoped
    // to the new workspace rather than the old one.
    setActiveWorkspaceId(workspaceId);
    set({ activeWorkspaceId: workspaceId });
    await api.post('/users/me/active-workspace', { workspaceId }).catch(() => undefined);
  },

  clear() {
    setAccessToken(null);
    setActiveWorkspaceId(null);
    set({ status: 'unauthenticated', user: null, workspaces: [], activeWorkspaceId: null, isOfflineSession: false });
    void cacheSet(SESSION_CACHE_KEY, null);
  },
}));

/**
 * Keep the offline snapshot current automatically, rather than remembering to
 * call `cacheSet` from every place `user` or `workspaces` can change (completing
 * onboarding, editing a preference, switching workspace, a goal notification
 * updating the profile...). One subscription here is what stops the cache — and
 * so a future offline reload — from quietly going stale the moment any of those
 * paths forgets to update it individually.
 */
useAuthStore.subscribe((state, previous) => {
  if (state.status !== 'authenticated' || !state.user) return;
  if (
    state.user === previous.user &&
    state.workspaces === previous.workspaces &&
    state.activeWorkspaceId === previous.activeWorkspaceId
  ) {
    return;
  }
  void cacheSet(SESSION_CACHE_KEY, {
    user: state.user,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
  } satisfies CachedSession);
});

/**
 * Wire the API client's "refresh failed" signal to the store. Called once at boot.
 *
 * Fires whenever a mid-session access-token refresh fails — which happens both
 * when a session has genuinely ended (revoked, expired, reused token) and when
 * the device simply has no connection at that moment. Only the first case should
 * sign anyone out; the second is exactly the situation §39 asks the app to keep
 * working through, so it's left alone and the existing session (with
 * `isOfflineSession` set) continues to back whatever the UI can still render from
 * cache.
 */
export function installSessionLostHandler(): void {
  setSessionLostHandler((err) => {
    if (err instanceof ApiRequestError && err.isOffline) {
      useAuthStore.setState({ isOfflineSession: true });
      return;
    }
    useAuthStore.getState().clear();
  });

  // The mirror image: the moment a refresh succeeds again — reconnecting after a
  // spell offline — the session is no longer stale, whether or not the user ever
  // triggered a full `bootstrap()`.
  setSessionRestoredHandler(() => {
    if (useAuthStore.getState().isOfflineSession) {
      useAuthStore.setState({ isOfflineSession: false });
    }
  });
}

/** The workspace currently in context, or null before bootstrap completes. */
export function useActiveWorkspace(): WorkspaceDto | null {
  return useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? s.workspaces[0] ?? null,
  );
}
