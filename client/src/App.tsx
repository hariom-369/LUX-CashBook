import { lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { useDocumentLanguage } from './hooks/useDocumentMeta';
import { useAuthStore } from './stores/auth.store';
import { useUiStore } from './stores/ui.store';
import { LogoMark } from './components/brand/Logo';

import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage';
import { OnboardingPage } from './features/onboarding/OnboardingPage';

import { QuickAddSheet } from './features/transactions/QuickAddSheet';
import { PinLockScreen } from './components/PinLockScreen';
import { OfflineBanner } from './components/OfflineBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { useIdleLock } from './hooks/useIdleLock';
import { useOfflineSync } from './hooks/useOfflineSync';
import { useT } from './i18n';

/**
 * Route-level code splitting.
 *
 * The sign-in screens are small and load before there is any session to protect,
 * so they stay in the main bundle — splitting them would only add a waterfall for
 * every first-time visitor. Everything behind `AppShell` is the opposite case: it
 * is never seen until after authentication, several of these screens pull in
 * Recharts or PDFKit-adjacent code, and `AppShell` already wraps its `<Outlet>` in
 * a `Suspense`, so `lazy()` here is a straight win with no extra plumbing (§58).
 */
const HomeRoute = lazy(() => import('./features/dashboard/HomeRoute').then((m) => ({ default: m.HomeRoute })));
const DailyMoneyPage = lazy(() => import('./features/dashboard/DailyMoneyPage').then((m) => ({ default: m.DailyMoneyPage })));
const TransactionsPage = lazy(() => import('./features/transactions/TransactionsPage').then((m) => ({ default: m.TransactionsPage })));
const CashBookPage = lazy(() => import('./features/cashbook/CashBookPage').then((m) => ({ default: m.CashBookPage })));
const PeoplePage = lazy(() => import('./features/people/PeoplePage').then((m) => ({ default: m.PeoplePage })));
const PersonLedgerPage = lazy(() => import('./features/people/PersonLedgerPage').then((m) => ({ default: m.PersonLedgerPage })));
const AccountsPage = lazy(() => import('./features/accounts/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const AccountLedgerPage = lazy(() => import('./features/accounts/AccountLedgerPage').then((m) => ({ default: m.AccountLedgerPage })));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const NotFoundPage = lazy(() => import('./features/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const BudgetsPage = lazy(() => import('./features/budgets/BudgetsPage').then((m) => ({ default: m.BudgetsPage })));
const GoalsPage = lazy(() => import('./features/goals/GoalsPage').then((m) => ({ default: m.GoalsPage })));
const RecurringPage = lazy(() => import('./features/recurring/RecurringPage').then((m) => ({ default: m.RecurringPage })));
const BillsPage = lazy(() => import('./features/bills/BillsPage').then((m) => ({ default: m.BillsPage })));
const CalendarPage = lazy(() => import('./features/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const DocumentsPage = lazy(() => import('./features/documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })));
const GroupsPage = lazy(() => import('./features/groups/GroupsPage').then((m) => ({ default: m.GroupsPage })));
const GroupDetailPage = lazy(() => import('./features/groups/GroupDetailPage').then((m) => ({ default: m.GroupDetailPage })));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const InsightsPage = lazy(() => import('./features/insights/InsightsPage').then((m) => ({ default: m.InsightsPage })));
const AssistantPage = lazy(() => import('./features/assistant/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const InvoicesPage = lazy(() => import('./features/invoicing/InvoicesPage').then((m) => ({ default: m.InvoicesPage })));
const QuotationsPage = lazy(() => import('./features/invoicing/QuotationsPage').then((m) => ({ default: m.QuotationsPage })));
const ProjectsPage = lazy(() => import('./features/invoicing/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const ProductsPage = lazy(() => import('./features/business/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const PettyCashPage = lazy(() => import('./features/business/PettyCashPage').then((m) => ({ default: m.PettyCashPage })));
const DailyClosingPage = lazy(() => import('./features/business/DailyClosingPage').then((m) => ({ default: m.DailyClosingPage })));
const MonthClosingPage = lazy(() => import('./features/business/MonthClosingPage').then((m) => ({ default: m.MonthClosingPage })));
const CustomersPage = lazy(() => import('./features/business/PartyPages').then((m) => ({ default: m.CustomersPage })));
const SuppliersPage = lazy(() => import('./features/business/PartyPages').then((m) => ({ default: m.SuppliersPage })));

export function App() {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const user = useAuthStore((s) => s.user);
  const privacyDefault = user?.preferences.privacyModeDefault;
  const setPrivacyMode = useUiStore((s) => s.setPrivacyMode);
  const navigate = useNavigate();

  // A tapped push notification hands its link to whichever tab is focused
  // (see `lib/registerServiceWorker.ts`) rather than navigating itself.
  useEffect(() => {
    function onSwNavigate(event: Event) {
      const link = (event as CustomEvent<string>).detail;
      if (link) navigate(link);
    }
    window.addEventListener('khata:sw-navigate', onSwNavigate);
    return () => window.removeEventListener('khata:sw-navigate', onSwNavigate);
  }, [navigate]);

  // Restore the session from the httpOnly refresh cookie before rendering anything
  // that depends on it.
  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  useDocumentLanguage();
  useIdleLock();
  useOfflineSync();

  // Honour "always start with amounts hidden" (§38) once the profile is known.
  useEffect(() => {
    if (privacyDefault) setPrivacyMode(true);
  }, [privacyDefault, setPrivacyMode]);

  if (status === 'idle' || status === 'loading') {
    return <SplashScreen />;
  }

  return (
    <>
      <OfflineBanner />

      <Routes>
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />

        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<HomeRoute />} />
          <Route path="today" element={<DailyMoneyPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="cash-book" element={<CashBookPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="people/:id" element={<PersonLedgerPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="groups/:id" element={<GroupDetailPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/:id" element={<AccountLedgerPage />} />
          <Route path="settings/*" element={<SettingsPage />} />

          <Route path="budgets" element={<BudgetsPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="recurring" element={<RecurringPage />} />
          <Route path="bills" element={<BillsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="notifications" element={<NotificationsPage />} />

          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="quotations" element={<QuotationsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="inventory" element={<ProductsPage />} />
          <Route path="petty-cash" element={<PettyCashPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="daily-closing" element={<DailyClosingPage />} />
          <Route path="month-closing" element={<MonthClosingPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>

      {/* Mounted outside the routes so the quick-add sheet opens over any screen. */}
      {status === 'authenticated' && <QuickAddSheet />}
      {status === 'authenticated' && <PinLockScreen />}
      <UpdateBanner />
    </>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const onboardingCompleted = useAuthStore((s) => s.user?.onboardingCompleted ?? true);
  const location = useLocation();

  if (status !== 'authenticated') {
    // Remember where they were going so login can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (!onboardingCompleted && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Shown only while the session is being restored.
 *
 * Deliberately quiet — no spinner for the first moment, because a flash of loading
 * chrome on a fast connection looks worse than a beat of stillness.
 */
function SplashScreen() {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-canvas">
      <LogoMark className="size-11 animate-pulse" />
      <span className="sr-only">{t('app.loadingKhata')}</span>
    </div>
  );
}
