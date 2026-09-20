import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/ui/Toast';
import { ApiRequestError } from './lib/api';
import { installSessionLostHandler } from './stores/auth.store';
import { watchSystemTheme } from './stores/ui.store';
import { registerServiceWorker } from './lib/registerServiceWorker';
import './styles/theme.css';

/**
 * Query defaults.
 *
 * Retrying a 4xx is pointless — a 404 will still be a 404 — and retrying a 401
 * actively harms, because it would fire several refreshes at a rotating refresh
 * token and look like reuse. So only server errors and network failures retry.
 *
 * `refetchOnWindowFocus` is on for a deliberate reason: someone who adds a
 * transaction on their phone and switches back to their laptop should see it,
 * without wondering whether the number in front of them is current.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry(failureCount, error) {
        if (error instanceof ApiRequestError && !error.isRetryable) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      // A write is never retried automatically: a retried POST that actually
      // succeeded the first time would create a duplicate transaction. Retries are
      // the caller's decision, with an idempotency key.
      retry: false,
    },
  },
});

installSessionLostHandler();
watchSystemTheme();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
