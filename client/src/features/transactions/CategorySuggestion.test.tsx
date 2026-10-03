import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});
vi.mock('../../lib/queries5', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries5')>();
  return { ...actual, useInvalidateOrganise: () => () => {} };
});

import { api } from '../../lib/api';
import { CategorySuggestion } from './CategorySuggestion';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { hi } from '../../i18n/messages/hi';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const suggestion = { ruleId: 'r1', categoryId: 'c-telecom', categoryName: 'Telecom', pattern: 'jio', confidence: 'medium' as const };

function renderIt(props: Partial<React.ComponentProps<typeof CategorySuggestion>> = {}) {
  const onUse = vi.fn();
  render(
    <ToastProvider>
      <CategorySuggestion kind="expense" description="Jio recharge" categoryId="" onUse={onUse} {...props} />
    </ToastProvider>,
  );
  return onUse;
}

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  act(() => useAuthStore.setState({ user: null } as never));
});

describe('<CategorySuggestion> (§Phase 2)', () => {
  it('offers the rule\'s category with a confidence cue, and applies nothing until it is used', async () => {
    get.mockResolvedValue(suggestion);
    const onUse = renderIt();
    expect(await screen.findByText(/Suggested category: Telecom/)).toBeTruthy();
    expect(screen.getByText(/from your rule "jio" · worth a look/)).toBeTruthy();
    expect(onUse).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith('/category-rules/suggest', { query: { description: 'Jio recharge', payee: undefined, kind: 'expense' } });
  });

  it('shows the high-confidence cue for a trusted rule', async () => {
    get.mockResolvedValue({ ...suggestion, confidence: 'high' });
    renderIt();
    expect(await screen.findByText(/usually right/)).toBeTruthy();
  });

  it('"Use it" selects the category and tells the server the rule was accepted', async () => {
    get.mockResolvedValue(suggestion);
    const onUse = renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Use it' }));
    expect(onUse).toHaveBeenCalledWith('c-telecom');
    expect(post).toHaveBeenCalledWith('/category-rules/r1/confirm');
  });

  it('stays out of the way once a category is chosen', async () => {
    get.mockResolvedValue(suggestion);
    renderIt({ categoryId: 'c-food', categoryName: 'Food' });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText(/Suggested category/)).toBeNull();
  });

  it('does not even ask for text that is too short', async () => {
    renderIt({ description: 'a' });
    await new Promise((r) => setTimeout(r, 500));
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('with no matching rule but a chosen category, offers to remember the pairing as a rule', async () => {
    get.mockResolvedValue(null);
    renderIt({ description: 'Swiggy order', categoryId: 'c-food', categoryName: 'Food' });
    const input = (await screen.findByLabelText(/Next time, when the description contains/)) as HTMLInputElement;
    expect(input.value).toBe('swiggy'); // the longest word
    fireEvent.change(input, { target: { value: 'swiggy order' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remember this' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/category-rules', { pattern: 'swiggy order', categoryId: 'c-food' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remember this' })).toBeNull());
  });

  it('a failed lookup just means no suggestion', async () => {
    get.mockRejectedValue(new Error('offline'));
    renderIt();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText(/Suggested category/)).toBeNull();
  });

  it('is translated', async () => {
    act(() => useAuthStore.setState({ user: { preferences: { language: 'hi' } } } as never));
    get.mockResolvedValue(suggestion);
    renderIt();
    expect(await screen.findByText(hi['suggest.suggested']!.replace('{category}', 'Telecom'))).toBeTruthy();
  });
});
