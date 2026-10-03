import { LANGUAGES, resolveLanguage, useT } from '../i18n';
import { Select } from './ui/Input';
import { useUiStore } from '../stores/ui.store';

/**
 * The language choice for the signed-out screens (login, register, reset password), where there
 * is no account preference yet. It is remembered on this device; once someone signs in, their own
 * saved preference takes over — see `currentLanguage()` in `i18n`.
 */
export function LanguageSwitcher() {
  const t = useT();
  const deviceLanguage = useUiStore((s) => s.deviceLanguage);
  const setDeviceLanguage = useUiStore((s) => s.setDeviceLanguage);
  return (
    <Select
      aria-label={t('settings.language.label')}
      value={resolveLanguage(deviceLanguage)}
      className="w-auto min-w-[120px]"
      onChange={(event) => setDeviceLanguage(event.target.value)}
    >
      {Object.entries(LANGUAGES).map(([code, name]) => (
        <option key={code} value={code} lang={code}>
          {name}
        </option>
      ))}
    </Select>
  );
}
