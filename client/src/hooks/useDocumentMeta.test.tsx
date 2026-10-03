import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { composeTitle, useDocumentLanguage, useDocumentTitle } from './useDocumentMeta';
import { useAuthStore } from '../stores/auth.store';

afterEach(() => {
  document.documentElement.lang = 'en';
  document.title = '';
  act(() => useAuthStore.setState({ user: null } as never));
});

describe('document metadata (§Phase 16)', () => {
  it('puts the most specific part of the title first', () => {
    expect(composeTitle(['Settings', 'Security'])).toBe('Security · Settings · Khata');
    expect(composeTitle(['Welcome back'])).toBe('Welcome back · Khata');
  });

  it('keeps <html lang> in step with the interface language', () => {
    const { rerender } = renderHook(() => useDocumentLanguage());
    expect(document.documentElement.lang).toBe('en');
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    rerender();
    expect(document.documentElement.lang).toBe('hi');
    act(() => useAuthStore.setState({ user: null } as never));
    rerender();
    expect(document.documentElement.lang).toBe('en');
  });

  it('sets the title for a screen outside the app shell', () => {
    renderHook(() => useDocumentTitle('Create your account'));
    expect(document.title).toBe('Create your account · Khata');
  });
});
