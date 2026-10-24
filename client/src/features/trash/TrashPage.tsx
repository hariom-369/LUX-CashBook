import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  Bell,
  FileText,
  Flag,
  Info,
  Repeat,
  RotateCcw,
  Search,
  Target,
  Trash2,
  User,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { TRASH_ITEM_TYPES, TRASH_RETENTION_DAYS, formatDate, type TrashItemDto, type TrashItemType, type TrashRestoreResultDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Money } from '../../components/ui/Money';
import { Input, Select } from '../../components/ui/Input';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useTrash, useInvalidateAfterTrash } from '../../lib/queries5';
import { api, errorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { useDebounced } from '../../hooks/useDebounced';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n/messages/en';

const PAGE_SIZE = 25;

const TYPE_META: Record<TrashItemType, { label: MessageKey; icon: ReactNode }> = {
  transaction: { label: 'trash.type.transaction', icon: <ArrowLeftRight aria-hidden className="size-4" /> },
  account: { label: 'trash.type.account', icon: <Wallet aria-hidden className="size-4" /> },
  person: { label: 'trash.type.person', icon: <User aria-hidden className="size-4" /> },
  group: { label: 'trash.type.group', icon: <UsersRound aria-hidden className="size-4" /> },
  budget: { label: 'trash.type.budget', icon: <Target aria-hidden className="size-4" /> },
  goal: { label: 'trash.type.goal', icon: <Flag aria-hidden className="size-4" /> },
  recurring: { label: 'trash.type.recurring', icon: <Repeat aria-hidden className="size-4" /> },
  reminder: { label: 'trash.type.reminder', icon: <Bell aria-hidden className="size-4" /> },
  document: { label: 'trash.type.document', icon: <FileText aria-hidden className="size-4" /> },
};

const keyOf = (item: Pick<TrashItemDto, 'type' | 'id'>) => `${item.type}:${item.id}`;

/**
 * Trash (§Trash): everything deleted in the last 30 days, ready to restore — or to delete for
 * good, which only the workspace owner or an admin can do. The server does every check; this
 * page asks before anything permanent and reports exactly what happened.
 */
export function TrashPage() {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateAfterTrash();
  const role = useAuthStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.myRole ?? 'member');
  const canPurge = role === 'owner' || role === 'admin';
  const canRestore = role !== 'viewer';

  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 250);
  const [type, setType] = useState<TrashItemType | ''>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ kind: 'one'; item: TrashItemDto } | { kind: 'empty' } | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useTrash({ type: type || undefined, q: query || undefined, page, limit: PAGE_SIZE });
  const items = data?.items ?? [];

  // A new search or filter starts from page one with nothing selected.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [query, type]);

  function toggle(item: TrashItemDto) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyOf(item))) next.delete(keyOf(item));
      else next.add(keyOf(item));
      return next;
    });
  }

  async function restore(targets: TrashItemDto[]) {
    if (targets.length === 0) return;
    setBusy(targets.length === 1 ? keyOf(targets[0]!) : 'bulk');
    try {
      const results = await api.post<TrashRestoreResultDto[]>(
        '/trash/restore',
        { items: targets.map((i) => ({ type: i.type, id: i.id })) },
        { idempotencyKey: crypto.randomUUID() },
      );
      const failed = results.filter((r) => !r.ok);
      const restored = results.length - failed.length;
      if (restored > 0) toast.success(t.plural('trash.restored', restored));
      if (failed.length > 0) toast.error(t.plural('trash.couldNotRestore', failed.length), t.server(failed[0]!.error ?? ''));
      setSelected(new Set());
      invalidate();
    } catch (err) {
      toast.error(t('trash.couldNotRestoreThat'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirmPermanent() {
    if (!confirming) return;
    setBusy('permanent');
    try {
      if (confirming.kind === 'one') {
        await api.delete(`/trash/${confirming.item.type}/${confirming.item.id}`, { confirm: true });
        toast.success(t('trash.deletedForever'));
      } else {
        const result = await api.post<{ deleted: number; kept: number }>('/trash/empty', { confirm: true });
        toast.success(t('trash.emptied', { count: result.deleted }), result.kept > 0 ? t.plural('trash.keptBecauseLinked', result.kept) : undefined);
      }
      setSelected(new Set());
      invalidate();
    } catch (err) {
      toast.error(t('common.couldNotRemoveThat'), errorMessage(err));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const selectedItems = items.filter((i) => selected.has(keyOf(i)));
  const allOnPageSelected = items.length > 0 && items.every((i) => selected.has(keyOf(i)));
  const totalPages = data?.totalPages ?? 1;
  const filtered = Boolean(query || type);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.trash')}</h1>
          <p className="mt-0.5 max-w-xl text-[13px] text-ink-muted">{t('trash.intro', { days: TRASH_RETENTION_DAYS })}</p>
        </div>
        {canPurge && (data?.total ?? 0) > 0 && !filtered && (
          <Button variant="secondary" className="text-negative" leftIcon={<Trash2 className="size-4" />} onClick={() => setConfirming({ kind: 'empty' })}>
            {t('trash.emptyTrash')}
          </Button>
        )}
      </header>

      <Card bare>
        <div className="flex flex-col gap-2 border-b border-line-faint p-4 sm:flex-row sm:items-center sm:p-5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('trash.searchPlaceholder')}
            aria-label={t('trash.search')}
            maxLength={100}
            leftSlot={<Search aria-hidden className="size-4" />}
            wrapperClassName="flex-1"
          />
          <Select value={type} onChange={(e) => setType(e.target.value as TrashItemType | '')} aria-label={t('trash.filterByType')} className="sm:w-48">
            <option value="">{t('trash.allTypes')}</option>
            {TRASH_ITEM_TYPES.map((k) => (
              <option key={k} value={k}>{t(TYPE_META[k].label)}</option>
            ))}
          </Select>
        </div>

        {canRestore && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-faint bg-sunken/60 px-4 py-2.5 sm:px-5">
            <label className="flex items-center gap-2.5 text-[12.5px] text-ink-secondary">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={() => setSelected(allOnPageSelected ? new Set() : new Set(items.map(keyOf)))}
                className="size-4 rounded-sm border-line text-gold focus:ring-gold"
              />
              {selected.size > 0 ? t('trash.selectedCount', { count: selected.size }) : t('trash.selectAll')}
            </label>
            {selected.size > 0 && (
              <Button size="sm" variant="secondary" leftIcon={<RotateCcw className="size-3.5" />} loading={busy === 'bulk'} onClick={() => void restore(selectedItems)}>
                {t('trash.restoreSelected')}
              </Button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="p-5"><LoadingState rows={4} /></div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Trash2 className="size-5" />}
            title={filtered ? t('trash.nothingMatches') : t('trash.empty')}
            description={filtered ? t('trash.tryAnotherSearch') : t('trash.emptyHint', { days: TRASH_RETENTION_DAYS })}
          />
        ) : (
          <ul className={cn('divide-y divide-line-faint', isFetching && 'opacity-70 transition-opacity')}>
            {items.map((item) => (
              <TrashRow
                key={keyOf(item)}
                item={item}
                selectable={canRestore}
                selected={selected.has(keyOf(item))}
                onToggle={() => toggle(item)}
                onRestore={canRestore ? () => void restore([item]) : undefined}
                onDelete={canPurge ? () => setConfirming({ kind: 'one', item }) : undefined}
                restoring={busy === keyOf(item)}
              />
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line-faint px-4 py-3 text-[12.5px] text-ink-muted sm:px-5">
            <span>{t('trash.pageOf', { page, total: totalPages })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('trash.previous')}</Button>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t('trash.next')}</Button>
            </div>
          </div>
        )}
      </Card>

      <p className="flex gap-2 rounded-md bg-gold-soft px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-gold-strong" />
        <span>{t('trash.policyNote', { days: TRASH_RETENTION_DAYS })}</span>
      </p>

      <ConfirmDialog
        open={Boolean(confirming)}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmPermanent}
        title={confirming?.kind === 'one' ? t('trash.deleteForeverTitle', { name: confirming.item.name }) : t('trash.emptyTrashTitle')}
        description={confirming?.kind === 'one' ? t('trash.deleteForeverBody') : t('trash.emptyTrashBody')}
        confirmLabel={confirming?.kind === 'one' ? t('trash.deleteForever') : t('trash.emptyTrash')}
        tone="danger"
        busy={busy === 'permanent'}
      />
    </div>
  );
}

function TrashRow({
  item,
  selectable,
  selected,
  onToggle,
  onRestore,
  onDelete,
  restoring,
}: {
  item: TrashItemDto;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  restoring: boolean;
}) {
  const t = useT();
  const meta = TYPE_META[item.type];
  const urgent = item.daysRemaining <= 3;

  return (
    <li className={cn('flex items-start gap-3 px-4 py-3.5 sm:items-center sm:px-5', selected && 'bg-gold-soft/40')}>
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={t('trash.selectItem', { name: item.name })}
          className="mt-1 size-4 shrink-0 rounded-sm border-line text-gold focus:ring-gold sm:mt-0"
        />
      )}
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-secondary">{meta.icon}</span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 break-words text-[13.5px] font-medium text-ink">{item.name}</p>
          <Badge tone="outline">{t(meta.label)}</Badge>
        </div>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">
          {[
            item.detail,
            item.date ? formatDate(item.date) : null,
            t('trash.deletedOn', { date: formatDate(item.deletedAt) }),
            t('trash.goesOn', { date: formatDate(item.expiresAt) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
          <DaysLeft days={item.daysRemaining} urgent={urgent} />
          {item.amountMinor !== undefined && <Money amountMinor={item.amountMinor} currency={item.currency} size="sm" tone="neutral" compactDecimals />}
        </div>
      </div>

      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        {item.amountMinor !== undefined && <Money amountMinor={item.amountMinor} currency={item.currency} size="sm" tone="neutral" compactDecimals />}
        <DaysLeft days={item.daysRemaining} urgent={urgent} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onRestore && (
          <Button size="sm" variant="secondary" leftIcon={<RotateCcw className="size-3.5" />} loading={restoring} onClick={onRestore} aria-label={t('trash.restoreItem', { name: item.name })}>
            <span className="hidden sm:inline">{t('trash.restore')}</span>
          </Button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('trash.deleteItemForever', { name: item.name })}
            title={t('trash.deleteForever')}
            className="flex size-9 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-negative-soft hover:text-negative"
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </li>
  );
}

function DaysLeft({ days, urgent }: { days: number; urgent: boolean }) {
  const t = useT();
  return (
    <Badge tone={urgent ? 'warning' : 'neutral'} eyebrow>
      {t.plural('trash.daysLeft', days)}
    </Badge>
  );
}
