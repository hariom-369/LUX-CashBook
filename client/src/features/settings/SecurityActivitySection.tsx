import { useEffect, useState } from 'react';
import { KeyRound, LogIn, LogOut, ShieldCheck, UserPlus } from 'lucide-react';
import { formatDate, formatTime, type SecurityEventDto } from '@khata/shared';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { shortUserAgent } from './userAgent';

const ICONS: Partial<Record<SecurityEventDto['action'], typeof LogIn>> = {
  login: LogIn,
  logout: LogOut,
  password_changed: KeyRound,
  created: UserPlus,
};

/**
 * The user's own security history (sign-ins, password and PIN changes, signing
 * out everywhere) — the audit log the server already keeps, made visible so
 * someone can spot activity that wasn't them.
 */
export function SecurityActivitySection() {
  const t = useT();
  const [events, setEvents] = useState<SecurityEventDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<SecurityEventDto[]>('/users/me/security-activity')
      .then(setEvents)
      .catch(() => setFailed(true));
  }, []);

  return (
    <section className="border-t border-line-faint pt-6">
      <p className="text-[13.5px] font-medium text-ink">{t('security.activity.title')}</p>
      <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">{t('security.activity.description')}</p>

      {failed ? (
        <p className="mt-4 text-[12.5px] text-negative">{t('security.activity.error')}</p>
      ) : events === null ? (
        <p className="mt-4 text-[12.5px] text-ink-muted">{t('common.loading')}</p>
      ) : events.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-ink-muted">{t('security.activity.empty')}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-line-faint rounded-lg border border-line">
          {events.map((event) => {
            const EventIcon = ICONS[event.action] ?? ShieldCheck;
            return (
              <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                <EventIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{event.summary}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {t('security.activity.at', {
                      device: shortUserAgent(event.userAgent),
                      ip: event.ipAddress ?? t('security.activity.unknownIp'),
                    })}
                  </p>
                </div>
                <time
                  dateTime={event.createdAt}
                  className="shrink-0 whitespace-nowrap text-right text-[11px] text-ink-muted"
                >
                  {formatDate(event.createdAt)}
                  <br />
                  {formatTime(event.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
