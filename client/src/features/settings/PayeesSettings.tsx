import { useState } from 'react';
import { Pencil, Plus, Search, Store, Trash2 } from 'lucide-react';
import type { PayeeDto } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDebounced } from '../../hooks/useDebounced';
import { usePayees, useInvalidateLedger } from '../../lib/queries';
import { api, errorMessage } from '../../lib/api';
import { Input } from '../../components/ui/Input';
import { PayeeFormSheet } from './PayeeFormSheet';
import { useT } from '../../i18n';

/**
 * Payee directory (§8, docs/FEATURE_ROADMAP.md Phase 2). A merchant a
 * transaction can be recorded against — separate from `Person`, who carries a
 * lending balance a payee never should (docs/FINANCIAL_MODEL.md).
 */
export function PayeesSettings() {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const { data: payees = [], isLoading, isError, error, refetch } = usePayees({ search: debouncedSearch || undefined });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PayeeDto | null>(null);
  const [deleting, setDeleting] = useState<PayeeDto | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await api.delete<{ archived: boolean; deleted: boolean }>(`/payees/${deleting.id}`);
      invalidate();
      toast.success(result.archived ? t('settings.payeeArchivedItHasTransactionsSo') : t('settings.payeeDeleted'));
    } catch (err) {
      toast.error(t('settings.couldNotRemoveThatPayee'), errorMessage(err));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13.5px] font-medium text-ink">{t('settings.tab.payees')}</p>
          <p className="mt-1 text-[12px] text-ink-muted">{t('settings.merchantsAndCounterpartiesYouPayOr')}</p>
        </div>
        <Button size="sm" variant="secondary" leftIcon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          {t('settings.addPayee')}
        </Button>
      </div>

      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('settings.searchPayees')}
        leftSlot={<Search aria-hidden className="size-4" />}
        aria-label={t('settings.searchPayees2')}
      />

      {isLoading ? (
        <LoadingState rows={4} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : payees.length === 0 ? (
        <EmptyState
          icon={<Store className="size-5" />}
          title={debouncedSearch ? t('common.nobodyMatchesThat') : t('settings.noPayeesYet')}
          description={t('settings.addMerchantsYouPayOftenKhata')}
          action={
            !debouncedSearch ? (
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('settings.addYourFirstPayee')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line-faint rounded-lg border border-line">
          {payees.map((payee) => (
            <li key={payee.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 max-w-full truncate text-[13px] font-medium text-ink">{payee.name}</span>
                {payee.tags.map((tag) => (
                  <Badge key={tag} tone="outline" eyebrow>
                    {tag}
                  </Badge>
                ))}
              </span>
              <button
                type="button"
                onClick={() => setEditing(payee)}
                aria-label={t('settings.edit', { name: payee.name })}
                className="rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
              >
                <Pencil aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setDeleting(payee)}
                aria-label={t('settings.remove', { name: payee.name })}
                className="rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-negative"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PayeeFormSheet open={creating} payee={null} onClose={() => setCreating(false)} />
      <PayeeFormSheet open={Boolean(editing)} payee={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        title={t('accounts.removeNamed', { name: deleting?.name ?? t('common.thisPayee') })}
        description={t('settings.ifItHasAnyTransactionsIt')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
