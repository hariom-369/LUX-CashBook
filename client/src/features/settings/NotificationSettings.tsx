import { useId, useState } from 'react';
import type { UserDto } from '@khata/shared';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, errorMessage } from '../../lib/api';
import { disablePush, enablePush, isPushSupported } from '../../lib/push';
import { useT, msg, type MessageRef } from '../../i18n';

const ITEMS: Array<{ key: keyof UserDto['preferences']['notifications']; label: MessageRef; hint: MessageRef }> = [
  { key: 'moneyDue', label: msg('settings.moneyDueOrReceivable'), hint: msg('settings.loansComingDueEitherDirection') },
  { key: 'budgetAlerts', label: msg('settings.budgetAlerts'), hint: msg('settings.whenACategoryBudgetCrossesA') },
  { key: 'recurringReminders', label: msg('settings.recurringReminders'), hint: msg('settings.beforeARecurringPaymentPostsAnd') },
];

export function NotificationSettings() {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [saving, setSaving] = useState<string | null>(null);
  const t = useT();

  if (!user) return null;
  const notifications = user.preferences.notifications;

  async function toggle(key: string, value: boolean) {
    setSaving(key);
    try {
      const updated = await api.patch<UserDto>('/users/me/preferences', {
        notifications: { [key]: value },
      });
      setUser(updated);
    } catch (err) {
      toast.error(t('common.couldNotSaveThat'), errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  async function togglePush(value: boolean) {
    setSaving('push');
    try {
      if (value) {
        const result = await enablePush();
        if (result === 'unsupported') {
          toast.error(t('settings.notSupported'), t('settings.thisBrowserCannotReceivePushNotification'));
          return;
        }
        if (result === 'unavailable') {
          toast.error(t('settings.notSetUpYet'), t('settings.theServerHasNotConfiguredPush'));
          return;
        }
        if (result === 'denied') {
          toast.error(t('settings.permissionDenied'), t('settings.allowNotificationsForKhataInYour'));
          return;
        }
      } else {
        await disablePush();
      }
      const updated = await api.patch<UserDto>('/users/me/preferences', { notifications: { push: value } });
      setUser(updated);
    } catch (err) {
      toast.error(t('common.couldNotSaveThat'), errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[13.5px] font-medium text-ink">{t('settings.channels')}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{t('notifications.channels.note')}</p>

        <div className="mt-4 flex flex-col gap-4">
          <ChannelRow
            label={t('settings.inApp')}
            checked={notifications.inApp}
            busy={saving === 'inApp'}
            onChange={(value) => void toggle('inApp', value)}
          />
          {isPushSupported() && (
            <ChannelRow
              label={t('settings.browserPush')}
              hint={t('settings.aSystemNotificationEvenWhenKhata')}
              checked={notifications.push}
              busy={saving === 'push'}
              onChange={(value) => void togglePush(value)}
            />
          )}
        </div>
      </div>

      <div className="border-t border-line-faint pt-5">
        <p className="text-[13.5px] font-medium text-ink">{t('settings.whatToNotifyAbout')}</p>

        <div className="mt-4 flex flex-col gap-4">
          {ITEMS.map((item) => (
            <ChannelRow
              key={item.key}
              label={t(item.label.key)}
              hint={t(item.hint.key)}
              checked={notifications[item.key] as boolean}
              busy={saving === item.key}
              onChange={(value) => void toggle(item.key, value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChannelRow({
  label,
  hint,
  checked,
  busy,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p id={labelId} className="text-[13px] font-medium text-ink">{label}</p>
        {hint && <p id={hintId} className="mt-0.5 max-w-md text-[11.5px] leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        disabled={busy}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-gold' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
