import { Link } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { relativeDay } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useNotifications } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { useQueryClient } from '@tanstack/react-query';

/** The full notification centre (§41), reached from the bell icon. */
export function NotificationsPage() {
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const toast = useToast();
  const queryClient = useQueryClient();

  const items = data?.data ?? [];
  const unreadCount = (data?.meta?.unreadCount as number | undefined) ?? 0;

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      toast.error('Could not update notifications', errorMessage(err));
    }
  }

  async function markRead(id: string) {
    try {
      await api.post(`/notifications/${id}/read`);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      /* Non-critical — the notification simply stays marked unread. */
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Notifications</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" leftIcon={<Check className="size-3.5" />} onClick={() => void markAllRead()}>
            Mark all read
          </Button>
        )}
      </header>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={5} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell className="size-5" />}
            title="Nothing here yet"
            description="Budget alerts, loans coming due, and recurring reminders will show up here as they happen."
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {items.map((notification) => (
              <li key={notification.id}>
                <Link
                  to={notification.link ?? '#'}
                  onClick={() => !notification.isRead && void markRead(notification.id)}
                  className={cn(
                    'flex items-start gap-3.5 px-5 py-4 transition-colors hover:bg-sunken sm:px-6',
                    !notification.isRead && 'bg-gold-soft/40',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md',
                      notification.isRead ? 'bg-neutral-soft text-ink-secondary' : 'bg-gold-soft text-gold-strong',
                    )}
                  >
                    <Icon name={notification.icon} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px]', notification.isRead ? 'font-medium text-ink-secondary' : 'font-semibold text-ink')}>
                      {notification.title}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{notification.body}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">{relativeDay(notification.createdAt)}</p>
                  </div>
                  {!notification.isRead && <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
