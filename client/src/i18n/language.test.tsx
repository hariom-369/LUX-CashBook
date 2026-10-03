import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatDate, monthLabel } from '@khata/shared';
import { currentLanguage, tNow } from './index';
import { ApiRequestError } from '../lib/api';
import { bucketLabel } from '../lib/bucketLabel';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { AuthLayout } from '../layouts/AuthLayout';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';
import { hi } from './messages/hi';

const signIn = (language: string) =>
  act(() => useAuthStore.setState({ user: { name: 'Asha', preferences: { language } } } as never));
const signOut = () => act(() => useAuthStore.setState({ user: null } as never));
const device = (language: string) => act(() => useUiStore.setState({ deviceLanguage: language }));

beforeEach(() => {
  signOut();
  device('en');
});
afterEach(() => {
  cleanup();
  signOut();
  device('en');
  localStorage.clear();
});

describe('language in force (§Phase 14 — signed-out screens)', () => {
  it('follows the device while nobody is signed in', () => {
    expect(currentLanguage()).toBe('en');
    device('hi');
    expect(currentLanguage()).toBe('hi');
    expect(tNow('common.save')).toBe(hi['common.save']);
  });

  it('lets a signed-in user\'s own preference win over the device', () => {
    device('hi');
    signIn('en');
    expect(currentLanguage()).toBe('en');
    signIn('hi');
    device('en');
    expect(currentLanguage()).toBe('hi');
  });

  it('falls back to English for a language it does not have', () => {
    device('xx');
    expect(currentLanguage()).toBe('en');
  });
});

describe('<LanguageSwitcher> on the signed-out screens', () => {
  it('switches the interface and remembers the choice on this device', () => {
    render(
      <MemoryRouter>
        <AuthLayout title="Sign in">
          <p>form</p>
        </AuthLayout>
      </MemoryRouter>,
    );
    const select = screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement;
    expect(select.value).toBe('en');
    fireEvent.change(select, { target: { value: 'hi' } });
    expect(useUiStore.getState().deviceLanguage).toBe('hi');
    expect(localStorage.getItem('khata.language')).toBe('hi');
    // The switcher itself is now labelled in Hindi, and the page language follows.
    expect(screen.getByRole('combobox', { name: hi['settings.language.label']! })).toBeTruthy();
  });

  it('offers each language under its own name', () => {
    render(<LanguageSwitcher />);
    expect(screen.getByRole('option', { name: 'English' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'हिन्दी' })).toBeTruthy();
  });
});

describe('server messages in the chosen language (§Phase 14)', () => {
  const error = () =>
    new ApiRequestError(422, {
      code: 'VALIDATION_ERROR',
      message: 'Please check the highlighted fields.',
      fields: [{ path: 'pin', message: 'Enter your PIN.' }, { path: 'x', message: 'A message nobody translated.' }],
    });

  it('leaves English as it came', () => {
    const e = error();
    expect(e.message).toBe('Please check the highlighted fields.');
    expect(e.fields[0]!.message).toBe('Enter your PIN.');
  });

  it('translates the message and each field message for a signed-in Hindi user', () => {
    signIn('hi');
    const e = error();
    expect(e.message).toBe(hi['server.pleaseCheckTheHighlightedFields']);
    expect(e.fields[0]!.message).toBe(hi['server.enterYourPin']);
    expect(e.fields[1]!.message).toBe('A message nobody translated.');
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.fields[0]!.path).toBe('pin');
  });

  it('translates for a signed-out visitor who chose Hindi', () => {
    device('hi');
    expect(error().message).toBe(hi['server.pleaseCheckTheHighlightedFields']);
  });
});

describe('month names follow the language (§Phase 14)', () => {
  it('writes English month names by default', () => {
    expect(formatDate(new Date(2026, 9, 3), 'dd MMM yyyy')).toBe('03 Oct 2026');
    expect(monthLabel(2026, 9, true)).toBe('October 2026');
  });

  it('writes Hindi month names for a Hindi user, and goes back on sign-out', () => {
    signIn('hi');
    const october = monthLabel(2026, 9, true);
    expect(october).toMatch(/अक्टूबर/);
    expect(formatDate(new Date(2026, 9, 3), 'dd MMM yyyy')).not.toContain('Oct');
    expect(formatDate(new Date(2026, 9, 3), 'dd MMM yyyy')).toContain('03');
    expect(formatDate(new Date(2026, 9, 3), 'dd MMM yyyy')).toContain('2026');
    signOut();
    expect(monthLabel(2026, 9, true)).toBe('October 2026');
  });

  it('keeps numeric dates numeric whatever the language', () => {
    signIn('hi');
    expect(formatDate(new Date(2026, 9, 3), 'dd/MM/yyyy')).toBe('03/10/2026');
  });

  it('writes chart bucket labels in the language, and leaves anything else alone', () => {
    expect(bucketLabel({ label: '3 Oct', start: '2026-10-03' })).toBe('3 Oct');
    signIn('hi');
    expect(bucketLabel({ label: '3 Oct', start: '2026-10-03' })).toMatch(/^3 \S+$/);
    expect(bucketLabel({ label: '3 Oct', start: '2026-10-03' })).not.toContain('Oct');
    expect(bucketLabel({ label: 'Oct', start: '2026-10-01' })).toMatch(/अक्/);
    expect(bucketLabel({ label: '2026', start: '2026-01-01' })).toBe('2026');
    // A point from a server that does not send `start`, or a malformed one, is shown as written.
    expect(bucketLabel({ label: '3 Oct' })).toBe('3 Oct');
    expect(bucketLabel({ label: '3 Oct', start: 'nonsense' })).toBe('3 Oct');
  });
});
