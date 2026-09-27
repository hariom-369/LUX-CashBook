import { useQuery } from '@tanstack/react-query';
import { FEATURE_FLAG_NAMES, type FeatureFlag, type FeatureFlags } from '@khata/shared';
import { api } from './api';

/** Every flag off — what the app assumes until the server says otherwise. */
const ALL_OFF = Object.fromEntries(FEATURE_FLAG_NAMES.map((flag) => [flag, false])) as FeatureFlags;

/**
 * The feature flags the server has switched on (shared/src/features.ts).
 *
 * Anything not yet loaded — or unreachable, e.g. offline — counts as off, so a
 * flagged module can never flash into view and then disappear.
 */
export function useFeatureFlags(): FeatureFlags {
  const { data } = useQuery({
    queryKey: ['features'],
    // No `skipAuth`: the server's `optionalAuth` never requires the token (this
    // works before sign-in too), but sending it when we have one is what lets a
    // signed-in user's workspace-level overrides apply — see routes.ts#/features.
    queryFn: () => api.get<FeatureFlags>('/features'),
    staleTime: 10 * 60_000,
  });
  return { ...ALL_OFF, ...data };
}

/** Whether one flagged module is switched on. Hide its entry points when false. */
export function useFeature(flag: FeatureFlag): boolean {
  return useFeatureFlags()[flag];
}
