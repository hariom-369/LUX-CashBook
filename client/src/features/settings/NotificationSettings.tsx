import { useId, useState } from 'react';
import type { UserDto } from '@khata/shared';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

const ITEMS: Array<{ key: keyof UserDto['preferences']['notifications']; label: string; hint: string }> = [
  { key: 'moneyDue', label: 'Money due or receivable', hint: 'Loans coming due, either direction.' },
  { key: 'budgetAlerts', label: 'Budget alerts', hint: 'When a category budget crosses a threshold.' },
  { key: 'recurringReminders', label: 'Recurring reminders', hint: 'Before a recurring payment posts, and when one is waiting for you to confirm.' },
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
      toast.error('Could not save that', errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[13.5px] font-medium text-ink">Channels</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{t('notifications.channels.note')}</p>

        <div className="mt-4 flex flex-col gap-4">
          <ChannelRow
            label="In-app"
            checked={notifications.inApp}
            busy={saving === 'inApp'}
            onChange={(value) => void toggle('inApp', value)}
          />
        </div>
      </div>

      <div className="border-t border-line-faint pt-5">
        <p className="text-[13.5px] font-medium text-ink">What to notify about</p>

        <div className="mt-4 flex flex-col gap-4">
          {ITEMS.map((item) => (
            <ChannelRow
              key={item.key}
              label={item.label}
              hint={item.hint}
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
