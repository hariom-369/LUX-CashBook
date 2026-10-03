import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { DashboardPage } from './DashboardPage';

/**
 * What `/` shows (§Phase 2). The full dashboard unless the person chose the simplified
 * Daily Money view as their start screen — and `/?full=1` always reaches the full one, so
 * choosing the simple view never takes anything away.
 */
export function HomeRoute() {
  const prefersDaily = useAuthStore((s) => s.user?.preferences?.homeScreen === 'daily');
  const [params] = useSearchParams();
  if (prefersDaily && params.get('full') !== '1') return <Navigate to="/today" replace />;
  return <DashboardPage />;
}
