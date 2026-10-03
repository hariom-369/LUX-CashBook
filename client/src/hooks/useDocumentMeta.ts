import { useEffect } from 'react';
import { useT } from '../i18n';

const APP_NAME = 'Khata';

/** `document.title` for the current page: "<page> · Khata". Pass `null` to leave it alone. */
export function composeTitle(parts: string[]): string {
  return [...parts.slice().reverse(), APP_NAME].join(' · ');
}

/**
 * Keeps `<html lang>` in step with the interface language, so a screen reader
 * pronounces Hindi text with a Hindi voice instead of reading it as English (WCAG 3.1.1).
 */
export function useDocumentLanguage(): void {
  const { language } = useT();
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}

/** Sets `document.title` for a screen that isn't inside the authenticated shell (login, register…). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = composeTitle([title]);
  }, [title]);
}
