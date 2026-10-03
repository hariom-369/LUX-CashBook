import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { useAuthStore } from '../stores/auth.store';
import { listConflictsFor, type OutboxItem } from '../lib/offlineDb';
import { resolveOutboxConflict } from '../hooks/useOfflineSync';
import { useOfflineStore } from '../stores/offline.store';
import { useT } from '../i18n';
import { ScrollRegion } from './ui/ScrollRegion';

/**
 * Review a queued offline edit that conflicts with what's on the server now
 * (§Phase 15) — opened from the "Needs attention" state in `OfflineBanner`.
 *
 * Deliberately generic rather than custom-built per resource type: every
 * field the queued edit touched is shown next to the server's current value
 * for that same field, so this works for any mutation that carries a `rev`
 * without a bespoke diff view per form. Nothing here is applied until the
 * user explicitly picks "Keep mine" or "Discard mine" — never a silent
 * overwrite, never a silent drop.
 */
export function ConflictDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [conflicts, setConflicts] = useState<OutboxItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    void listConflictsFor(userId).then(setConflicts);
  }, [open, userId]);

  async function resolve(item: OutboxItem, action: 'discard' | 'overwrite') {
    setBusyId(item.id);
    try {
      const result = await resolveOutboxConflict(item, action, userId, queryClient);
      if (result.ok) toast.success(result.message, result.detail);
      else toast.error(result.message, result.detail);
      setConflicts((current) => current.filter((c) => c.id !== item.id));
    } finally {
      setBusyId(null);
    }
  }

  const remaining = useOfflineStore((s) => s.conflictCount);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('app.needsYourAttention')}
      description={t('app.theseOfflineEditsConflictWithChanges')}
      size="lg"
    >
      {conflicts.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-muted">
          {remaining > 0 ? 'Loading…' : t('app.nothingLeftToReview')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {conflicts.map((item) => (
            <li key={item.id} className="rounded-md border border-line-faint p-4">
              <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium text-negative">
                <AlertTriangle aria-hidden className="size-4" />
                {item.method} {item.path}
              </div>

              <ConflictFieldDiff item={item} />

              <div className="mt-4 flex items-center justify-end gap-2">
                <Button size="sm" variant="secondary" loading={busyId === item.id} onClick={() => void resolve(item, 'discard')}>
                  {t('app.discardMine')}
                </Button>
                <Button size="sm" variant="gold" loading={busyId === item.id} onClick={() => void resolve(item, 'overwrite')}>
                  {t('app.keepMine')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function ConflictFieldDiff({ item }: { item: OutboxItem }) {
  const t = useT();
  const server = (item.conflict?.serverVersion ?? null) as Record<string, unknown> | null;

  if (!server) {
    return <p className="text-[12.5px] text-ink-muted">{t('app.theRecordThisEditTargetedNo')}</p>;
  }

  const fields = Object.keys(item.body).filter((key) => key !== 'rev');

  return (
<ScrollRegion label={t('scroll.conflict')}>
      <table className="w-full min-w-[420px] text-left text-[12.5px]">
        <thead>
          <tr className="text-ink-faint">
            <th className="py-1 pr-3 font-normal">{t('app.field')}</th>
            <th className="py-1 pr-3 font-normal">{t('app.yourValue')}</th>
            <th className="py-1 font-normal">{t('app.currentValue')}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const mine = item.body[field];
            const theirs = server[field];
            const changed = JSON.stringify(mine) !== JSON.stringify(theirs);
            return (
              <tr key={field} className="border-t border-line-faint">
                <td className="py-1.5 pr-3 font-medium text-ink">{field}</td>
                <td className={`py-1.5 pr-3 ${changed ? 'text-gold-strong' : 'text-ink-muted'}`}>{formatValue(mine)}</td>
                <td className={`py-1.5 ${changed ? 'font-medium text-ink' : 'text-ink-muted'}`}>{formatValue(theirs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
