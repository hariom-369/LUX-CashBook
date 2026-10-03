import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from './ui/Sheet';
import { useUiStore } from '../stores/ui.store';
import { GO_TARGETS, resolveShortcut } from '../lib/shortcuts';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n/messages/en';

/** Registers the global shortcuts (§Phase 16) and renders their help sheet (`?`). */
export function KeyboardShortcuts() {
  const t = useT();
  const navigate = useNavigate();
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const awaitingGo = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = resolveShortcut(event, awaitingGo.current);
      awaitingGo.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (!action) return;

      if (action.type === 'pendingG') {
        awaitingGo.current = true;
        timer.current = setTimeout(() => (awaitingGo.current = false), 1500);
        return;
      }
      event.preventDefault();
      if (action.type === 'quickAdd') setQuickAddOpen(true);
      else if (action.type === 'help') setHelpOpen(true);
      else navigate(action.to);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, setQuickAddOpen]);

  return (
    <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title={t('app.keyboardShortcuts')} size="sm">
      <dl className="flex flex-col gap-2 text-[13px]">
        <Row keys="Ctrl/⌘ + K" label={t('app.searchAndCommands')} />
        <Row keys="n" label={t('app.newEntryQuickAdd')} />
        <Row keys="?" label={t('app.thisList')} />
        {Object.entries(GO_TARGETS).map(([key, { to, label }]) => (
          <Row key={key} keys={t('app.gThen', { key })} label={t('app.goTo', { label: t(`nav.${to === '/' ? 'dashboard' : to.slice(1)}` as MessageKey) ?? label })} />
        ))}
      </dl>
    </Sheet>
  );
}

function Row({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-secondary">{label}</dt>
      <dd>
        <kbd className="rounded-sm border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{keys}</kbd>
      </dd>
    </div>
  );
}
