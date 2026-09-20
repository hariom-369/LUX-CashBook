import { useState } from 'react';
import { CURRENCIES, DATE_FORMATS, THEMES, type Theme, type UserDto } from '@khata/shared';
import { Select } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { api, errorMessage } from '../../lib/api';

const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'Match system' };

/**
 * Display preferences (§6, §54).
 *
 * Every control here saves immediately on change — a "Save" button for a toggle
 * would just be friction, and these settings are exactly the kind of thing a user
 * wants to see take effect right away.
 */
export function PreferencesSettings() {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setTheme = useUiStore((s) => s.setTheme);
  const theme = useUiStore((s) => s.theme);

  const [saving, setSaving] = useState<string | null>(null);

  if (!user) return null;
  const prefs = user.preferences;

  async function patch(field: string, body: Record<string, unknown>) {
    setSaving(field);
    try {
      const updated = await api.patch<UserDto>('/users/me/preferences', body);
      setUser(updated);
    } catch (err) {
      toast.error('Could not save that preference', errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Row
        label="Theme"
        hint="Match system follows your device's light/dark setting automatically."
        busy={saving === 'theme'}
      >
        <Select
          value={theme}
          className="w-auto min-w-[160px]"
          onChange={(event) => {
            const value = event.target.value as Theme;
            setTheme(value);
            void patch('theme', { theme: value });
          }}
        >
          {THEMES.map((option) => (
            <option key={option} value={option}>
              {THEME_LABELS[option]}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Currency" hint="The default for new workspaces. Existing workspaces keep their own currency." busy={saving === 'currency'}>
        <Select
          value={prefs.currency}
          className="w-auto min-w-[200px]"
          onChange={(event) => void patch('currency', { currency: event.target.value })}
        >
          {Object.values(CURRENCIES).map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.symbol} · {currency.name}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Number format" busy={saving === 'numberFormat'}>
        <Select
          value={prefs.numberFormat}
          className="w-auto min-w-[200px]"
          onChange={(event) => void patch('numberFormat', { numberFormat: event.target.value })}
        >
          <option value="indian">Indian (₹1,25,000)</option>
          <option value="western">Western (₹125,000)</option>
        </Select>
      </Row>

      <Row label="Date format" busy={saving === 'dateFormat'}>
        <Select
          value={prefs.dateFormat}
          className="w-auto min-w-[180px]"
          onChange={(event) => void patch('dateFormat', { dateFormat: event.target.value })}
        >
          {DATE_FORMATS.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="First day of week" busy={saving === 'firstDayOfWeek'}>
        <Select
          value={String(prefs.firstDayOfWeek)}
          className="w-auto min-w-[140px]"
          onChange={(event) => void patch('firstDayOfWeek', { firstDayOfWeek: Number(event.target.value) })}
        >
          <option value="0">Sunday</option>
          <option value="1">Monday</option>
          <option value="6">Saturday</option>
        </Select>
      </Row>

      <div className="border-t border-line-faint pt-5">
        <Row
          label="Accounting view"
          hint="Show Debit / Credit / contra terminology instead of Money In / Money Out, for anyone used to formal bookkeeping (§54)."
          busy={saving === 'accountingView'}
        >
          <Toggle
            checked={prefs.accountingView}
            onChange={(value) => void patch('accountingView', { accountingView: value })}
          />
        </Row>

        <Row
          label="Start with amounts hidden"
          hint="Every figure is masked when you open the app, until you tap to reveal it (§38)."
          busy={saving === 'privacyModeDefault'}
          className="mt-4"
        >
          <Toggle
            checked={prefs.privacyModeDefault}
            onChange={(value) => void patch('privacyModeDefault', { privacyModeDefault: value })}
          />
        </Row>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
  busy,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-6 ${className ?? ''}`}>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      <div className={`shrink-0 transition-opacity ${busy ? 'opacity-50' : ''}`}>{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-gold' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
