import { useEffect, useState } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useInvalidateLedger } from '../../lib/queries';
import { api, errorMessage } from '../../lib/api';
import type { AccountReconcilePreviewDto } from '@khata/shared';
import { useT } from '../../i18n';

/**
 * Account reconciliation (docs/PRODUCT_AUDIT.md D-3, Phase 5).
 *
 * Reads the statement balance, previews the gap against Khata's own, and —
 * only on explicit confirmation — posts the difference as an `adjustment`
 * transaction. A zero difference still "reconciles" (nothing to post) rather
 * than silently doing nothing, so there's a record that the account was
 * checked.
 */
export function ReconcileDialog({ accountId, accountName, open, onClose }: { accountId: string; accountName: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateLedger();

  const [statementBalanceMinor, setStatementBalanceMinor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<AccountReconcilePreviewDto | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatementBalanceMinor(null);
    setNote('');
    setPreview(null);
  }, [open]);

  async function checkDifference() {
    if (statementBalanceMinor === null) return;
    setBusy(true);
    try {
      setPreview(
        await api.get<AccountReconcilePreviewDto>(`/accounts/${accountId}/reconcile/preview`, {
          query: { statementBalanceMinor: String(statementBalanceMinor) },
        }),
      );
    } catch (err) {
      toast.error(t('accounts.couldNotCheckThat'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (statementBalanceMinor === null) return;
    setBusy(true);
    try {
      const result = await api.post<{ differenceMinor: number }>(`/accounts/${accountId}/reconcile`, {
        statementBalanceMinor,
        note: note.trim() || undefined,
      });
      invalidate();
      toast.success(
        result.differenceMinor === 0 ? t('accounts.reconciledNoDifference') : t('accounts.reconciled'),
        result.differenceMinor === 0 ? undefined : t('accounts.anAdjustmentWasPostedForThe'),
      );
      onClose();
    } catch (err) {
      toast.error(t('accounts.couldNotReconcileThat'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('accounts.reconcile2', { accountName })}
      description={t('accounts.enterTheBalanceFromYourReal')}
      size="sm"
      busy={busy}
      footer={
        preview ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)}>
              {t('common.back')}
            </Button>
            <Button variant="gold" loading={busy} onClick={() => void confirm()}>
              {preview.differenceMinor === 0 ? t('accounts.markAsReconciled') : t('accounts.postAdjustmentReconcile')}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="gold" loading={busy} disabled={statementBalanceMinor === null} onClick={() => void checkDifference()}>
              {t('accounts.checkDifference')}
            </Button>
          </div>
        )
      }
    >
      {!preview ? (
        <div className="flex flex-col gap-4 pb-2">
          <Field label={t('accounts.statementBalance')} required>
            {({ id }) => <MoneyInput id={id} size="hero" value={statementBalanceMinor} onChange={setStatementBalanceMinor} />}
          </Field>
          <Field label={t('common.note')} hint={t('accounts.optionalShownOnTheAdjustmentEntry')}>
            {({ id }) => <Input id={id} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg border border-line bg-sunken p-3">
              <p className="label-eyebrow">{t('accounts.khataSBalance')}</p>
              <Money amountMinor={preview.ledgerBalanceMinor} size="md" tone="neutral" compactDecimals />
            </div>
            <div className="rounded-lg border border-line bg-sunken p-3">
              <p className="label-eyebrow">{t('accounts.statement')}</p>
              <Money amountMinor={preview.statementBalanceMinor} size="md" tone="neutral" compactDecimals />
            </div>
          </div>
          <div className="rounded-lg border border-line bg-sunken/50 p-3 text-center">
            <p className="label-eyebrow">{t('accounts.difference')}</p>
            <Money
              amountMinor={Math.abs(preview.differenceMinor)}
              size="lg"
              tone={preview.differenceMinor === 0 ? 'neutral' : preview.differenceMinor > 0 ? 'positive' : 'negative'}
              compactDecimals
            />
            {preview.differenceMinor !== 0 && (
              <p className="mt-1 text-[11.5px] text-ink-muted">
                {preview.differenceMinor > 0 ? 'The statement is higher — an "in" adjustment will be posted.' : 'The statement is lower — an "out" adjustment will be posted.'}
              </p>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
