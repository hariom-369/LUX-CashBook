import type { MessageKey } from './en';

/**
 * Hindi. Partial by design: any key missing here falls back to English, so a new
 * English string never breaks the Hindi build. Full coverage is Phase 14.
 */
export const hi: Partial<Record<MessageKey, string>> = {
  'common.cancel': 'रद्द करें',
  'common.close': 'बंद करें',
  'common.delete': 'हटाएँ',
  'common.retry': 'फिर से कोशिश करें',
  'common.save': 'सहेजें',
  'common.loading': 'लोड हो रहा है…',
  'install.action': 'खाता इंस्टॉल करें',
  'pin.unlock': 'अनलॉक करें',
};
