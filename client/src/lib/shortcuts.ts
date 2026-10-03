/**
 * Global keyboard shortcuts (§Phase 16). Pure resolution logic, kept apart from
 * the React component so it can be tested without a DOM.
 *
 * `n` opens Quick Add; `g` then a letter navigates (a two-key sequence, so no
 * single letter steals browsing keys); `?` opens the help sheet. Ctrl/Cmd+K is
 * the command palette's own and is deliberately not handled here.
 */
export type ShortcutAction = { type: 'quickAdd' } | { type: 'help' } | { type: 'go'; to: string } | { type: 'pendingG' };

export const GO_TARGETS: Record<string, { to: string; label: string }> = {
  d: { to: '/', label: 'Dashboard' },
  t: { to: '/transactions', label: 'Transactions' },
  p: { to: '/people', label: 'People' },
  a: { to: '/accounts', label: 'Accounts' },
  b: { to: '/budgets', label: 'Budgets' },
  r: { to: '/reports', label: 'Reports' },
  s: { to: '/settings', label: 'Settings' },
};

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function resolveShortcut(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null },
  awaitingGo: boolean,
): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return null;

  if (awaitingGo) {
    const target = GO_TARGETS[event.key.toLowerCase()];
    return target ? { type: 'go', to: target.to } : null;
  }
  if (event.key === 'n') return { type: 'quickAdd' };
  if (event.key === '?') return { type: 'help' };
  if (event.key === 'g') return { type: 'pendingG' };
  return null;
}
