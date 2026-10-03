import { useState } from 'react';
import { CURRENCIES, DATE_FORMATS, THEMES, type Theme, type UserDto } from '@khata/shared';
import { Select } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { api, errorMessage } from '../../lib/api';
import { LANGUAGES, useT, msg, type MessageRef } from '../../i18n';

const THEME_LABELS: Record<Theme, MessageRef> = { light: msg('settings.light'), dark: msg('settings.dark'), system: msg('settings.matchSystem') };

/**
 * Display preferences (§6, §54).
 *
 * Every control here saves immediately on change — a "Save" button for a toggle
 * would just be friction, and these settings are exactly the kind of thing a user
 * wants to see take effect right away.
 */
export function PreferencesSettings() {
  const toast = useToast();
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setTheme = useUiStore((s) => s.setTheme);
  const setDeviceLanguage = useUiStore((s) => s.setDeviceLanguage);
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
      toast.error(t('settings.couldNotSaveThatPreference'), errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Row
        label={t('settings.theme')}
        hint={t('settings.matchSystemFollowsYourDeviceS')}
        busy={saving === 'theme'}
      >
        <Select
          aria-label={t('settings.theme')}
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
              {t(THEME_LABELS[option].key)}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('settings.language.label')} hint={t('settings.language.hint')} busy={saving === 'language'}>
        <Select
          aria-label={t('settings.language.label')}
          value={prefs.language}
          className="w-auto min-w-[160px]"
          onChange={(event) => {
            // Remembered on this device too, so the sign-in screen is in the same language after sign-out.
            setDeviceLanguage(event.target.value);
            void patch('language', { language: event.target.value });
          }}
        >
          {Object.entries(LANGUAGES).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('common.currency')} hint={t('settings.theDefaultForNewWorkspacesExisting')} busy={saving === 'currency'}>
        <Select
          aria-label={t('common.currency')}
          value={prefs.currency}
          className="w-auto min-w-[200px]"
          onChange={(event) => void patch('currency', { currency: event.target.value })}
        >
          {Object.values(CURRENCIES).map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.symbol} · {t.label('currency', currency.code, currency.name)}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('settings.numberFormat')} busy={saving === 'numberFormat'}>
        <Select
          aria-label={t('settings.numberFormat')}
          value={prefs.numberFormat}
          className="w-auto min-w-[200px]"
          onChange={(event) => void patch('numberFormat', { numberFormat: event.target.value })}
        >
          <option value="indian">{t('settings.indian125000')}</option>
          <option value="western">{t('settings.western125000')}</option>
        </Select>
      </Row>

      <Row label={t('settings.dateFormat')} busy={saving === 'dateFormat'}>
        <Select
          aria-label={t('settings.dateFormat')}
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

      <Row label={t('settings.firstDayOfWeek')} busy={saving === 'firstDayOfWeek'}>
        <Select
          aria-label={t('settings.firstDayOfWeek')}
          value={String(prefs.firstDayOfWeek)}
          className="w-auto min-w-[140px]"
          onChange={(event) => void patch('firstDayOfWeek', { firstDayOfWeek: Number(event.target.value) })}
        >
          <option value="0">{t('settings.sunday')}</option>
          <option value="1">{t('settings.monday')}</option>
          <option value="6">{t('settings.saturday')}</option>
        </Select>
      </Row>

      <Row label={t('settings.homeScreen')} hint={t('settings.homeScreenHint')} busy={saving === 'homeScreen'}>
        <Select
          aria-label={t('settings.homeScreen')}
          value={prefs.homeScreen ?? 'dashboard'}
          className="w-auto min-w-[180px]"
          onChange={(event) => void patch('homeScreen', { homeScreen: event.target.value })}
        >
          <option value="dashboard">{t('settings.homeScreen.dashboard')}</option>
          <option value="daily">{t('settings.homeScreen.daily')}</option>
        </Select>
      </Row>

      <div className="border-t border-line-faint pt-5">
        <Row
          label={t('settings.accountingView')}
          hint={t('settings.showDebitCreditContraTerminologyInstead')}
          busy={saving === 'accountingView'}
        >
          <Toggle
            label={t('settings.accountingView')}
            checked={prefs.accountingView}
            onChange={(value) => void patch('accountingView', { accountingView: value })}
          />
        </Row>

        <Row
          label={t('settings.startWithAmountsHidden')}
          hint={t('settings.everyFigureIsMaskedWhenYou')}
          busy={saving === 'privacyModeDefault'}
          className="mt-4"
        >
          <Toggle
            label={t('settings.startWithAmountsHidden')}
            checked={prefs.privacyModeDefault}
            onChange={(value) => void patch('privacyModeDefault', { privacyModeDefault: value })}
          />
        </Row>

        <Row
          label={t('settings.aiAssistant')}
          hint={t('settings.letsYouAskQuestionsAboutYour')}
          busy={saving === 'aiAssistantEnabled'}
          className="mt-4"
        >
          <Toggle
            label={t('settings.aiAssistant')}
            checked={prefs.aiAssistantEnabled}
            onChange={(value) => void patch('aiAssistantEnabled', { aiAssistantEnabled: value })}
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
    // The control drops below the label only when both can't share the row (narrow phones).
    <div className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 ${className ?? ''}`}>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-[13.5px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      <div className={`shrink-0 transition-opacity ${busy ? 'opacity-50' : ''}`}>{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-gold' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
