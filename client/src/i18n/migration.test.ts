import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  ACCOUNT_TYPE_META, BILL_KIND_LABELS, GOAL_ICONS, CURRENCIES, DOCUMENT_TYPE_LABELS, INVOICE_STATUS_META, PAYMENT_METHOD_LABELS,
  PERSON_RELATIONSHIP_LABELS, QUOTATION_STATUS_META, RANGE_PRESET_LABELS, STOCK_MOVEMENT_LABELS, TRANSACTION_META,
  WORKSPACE_ROLE_LABELS,
} from '@khata/shared';
import { msg, sharedLabel, tNow, tNowPlural, translate, useT, type LabelGroup } from './index';
import { en } from './messages/en';
import { hi } from './messages/hi';
import { useAuthStore } from '../stores/auth.store';
import type { MessageKey } from './messages/en';

const require = createRequire(import.meta.url);

describe('Hindi migration guard (§Phase 14)', () => {
  it('leaves no user-visible string in client TSX outside the i18n catalogue', () => {
    const { scanClient } = require('../../tools/i18n-scan.cjs') as { scanClient: (root?: string) => string[] };
    // A failure lists file + string, so a new hard-coded label is easy to find.
    expect(scanClient('src')).toEqual([]);
    // Parses every client source file: ~1 s alone, over the 5 s default when the whole suite runs in parallel.
  }, 30_000);

  it('never leaves a Hindi value identical to a raw message key', () => {
    for (const [key, value] of Object.entries(hi)) expect(value, key).not.toBe(key);
  });

  it('keeps every {placeholder} that English uses in the Hindi string', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const key of Object.keys(en) as MessageKey[]) {
      const h = hi[key];
      if (typeof h === 'string') expect(holes(h), key).toBe(holes(en[key]));
    }
  });
});

describe('msg() and t.maybe()', () => {
  it('msg() wraps a key without becoming renderable text', () => {
    const ref = msg('common.save');
    expect(ref.key).toBe('common.save');
    expect(typeof ref).toBe('object');
  });

  it('t.maybe() translates catalogue keys and passes any other text through', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    const { result } = renderHook(() => useT());
    expect(result.current.maybe('common.save')).toBe(translate('hi', 'common.save'));
    expect(result.current.maybe('Server said no')).toBe('Server said no');
    act(() => useAuthStore.setState({ user: null } as never));
  });

  it('switches language live with the signed-in user preference', () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'en' } } } as never));
    const { result, rerender } = renderHook(() => useT());
    expect(result.current('common.save')).toBe('Save');
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    rerender();
    expect(result.current('common.save')).toBe(hi['common.save']);
    act(() => useAuthStore.setState({ user: null } as never));
  });
});

describe('shared-package labels (§Phase 14)', () => {
  // `@khata/shared` owns these English labels; the client translates them by `group.id`.
  // A new status, preset or type added there without a catalogue entry fails here.
  const groups: Array<[LabelGroup, Record<string, string>]> = [
    ['txType', Object.fromEntries(Object.entries(TRANSACTION_META).map(([k, v]) => [k, v.label]))],
    ['accountType', Object.fromEntries(Object.entries(ACCOUNT_TYPE_META).map(([k, v]) => [k, v.label]))],
    ['paymentMethod', PAYMENT_METHOD_LABELS],
    ['relationship', PERSON_RELATIONSHIP_LABELS],
    ['billKind', BILL_KIND_LABELS],
    ['role', WORKSPACE_ROLE_LABELS],
    ['docType', DOCUMENT_TYPE_LABELS],
    ['invoiceStatus', Object.fromEntries(Object.entries(INVOICE_STATUS_META).map(([k, v]) => [k, v.label]))],
    ['quotationStatus', Object.fromEntries(Object.entries(QUOTATION_STATUS_META).map(([k, v]) => [k, v.label]))],
    ['stockMovement', STOCK_MOVEMENT_LABELS],
    ['range', RANGE_PRESET_LABELS],
    ['currency', Object.fromEntries(Object.values(CURRENCIES).map((c) => [c.code, c.name]))],
  ];

  it('has an English entry that matches the shared label, and a Hindi one, for every id', () => {
    for (const [group, labels] of groups) {
      for (const [id, english] of Object.entries(labels)) {
        const key = `${group}.${id}` as MessageKey;
        expect(en[key], key).toBe(english);
        expect(hi[key], key).toBeTruthy();
      }
    }
  });

  it('every goal icon has a spoken name in English and Hindi (icon-only buttons need one)', () => {
    for (const icon of GOAL_ICONS) {
      expect(`goalIcon.${icon}` in en, icon).toBe(true);
      expect(`goalIcon.${icon}` in hi, icon).toBe(true);
    }
  });

  it('sharedLabel() translates known ids and keeps the shared English for unknown ones', () => {
    expect(sharedLabel('hi', 'range', 'last_30_days', 'Last 30 Days')).toBe(hi['range.last_30_days']);
    expect(sharedLabel('en', 'range', 'last_30_days', 'Last 30 Days')).toBe('Last 30 Days');
    expect(sharedLabel('hi', 'range', 'a_future_preset', 'A Future Preset')).toBe('A Future Preset');
  });
});

describe('tNow() — translation outside React', () => {
  it('follows the signed-in language at call time, including plurals', () => {
    useAuthStore.setState({ user: { preferences: { language: 'en' } } } as never);
    expect(tNow('sync.discarded')).toBe('Discarded your offline edit');
    expect(tNowPlural('sync.synced', 1)).toBe('Synced 1 offline entry');
    expect(tNowPlural('sync.synced', 3)).toBe('Synced 3 offline entries');
    useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never);
    expect(tNow('sync.discarded')).toBe(hi['sync.discarded']);
    expect(tNowPlural('sync.synced', 3)).toBe('3 ऑफ़लाइन एंट्रियाँ सिंक हुईं');
    useAuthStore.setState({ user: null } as never);
  });

  it('every plural base defines both forms in both languages', () => {
    for (const key of Object.keys(en)) {
      if (!key.endsWith('.one')) continue;
      const base = key.slice(0, -4);
      expect(`${base}.other` in en, base).toBe(true);
      expect(`${base}.one` in hi && `${base}.other` in hi, base).toBe(true);
    }
  });
});
