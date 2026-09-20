import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';
import {
  PAYMENT_METHOD_LABELS,
  TRANSACTION_META,
  formatDate,
  formatTime,
  type TransactionDto,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet, ConfirmDialog } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useInvalidateLedger } from '../../lib/queries';
import { AttachmentList } from './AttachmentList';

/**
 * Transaction detail (§25).
 *
 * Every field the ledger holds, plus the four actions that matter: duplicate,
 * delete, restore, and a link out to the person or account involved.
 *
 * Delete offers UNDO through the toast rather than a confirmation dialog (§43).
 * That is the better trade for a reversible action performed often: a dialog on
 * every delete is friction on the common case, while a soft delete plus an undo
 * makes the mistake case cheap. Irreversible actions still get a dialog.
 */
export function TransactionDetailSheet({
  transaction,
  onClose,
}: {
  transaction: TransactionDto | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateLedger();

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!transaction) return null;

  const meta = TRANSACTION_META[transaction.type];
  const isTransfer = meta.isTransfer;
  const isLoan = transaction.type === 'lend' || transaction.type === 'borrow';

  async function remove() {
    if (!transaction) return;
    setBusy(true);
    try {
      await api.delete(`/transactions/${transaction.id}`);
      invalidate();
      onClose();

      toast.undo('Transaction deleted', async () => {
        try {
          await api.post(`/transactions/${transaction.id}/restore`);
          invalidate();
          toast.success('Transaction restored');
        } catch (err) {
          toast.error('Could not restore that', errorMessage(err));
        }
      });
    } catch (err) {
      // A loan with repayments cannot be deleted; the API says why, so show that.
      toast.error('Could not delete that', errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  async function restore() {
    if (!transaction) return;
    setBusy(true);
    try {
      await api.post(`/transactions/${transaction.id}/restore`);
      invalidate();
      toast.success('Transaction restored');
      onClose();
    } catch (err) {
      toast.error('Could not restore that', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (!transaction) return;
    setBusy(true);
    try {
      await api.post(`/transactions/${transaction.id}/duplicate`, {});
      invalidate();
      toast.success('Duplicated', 'A copy was added with today’s date.');
      onClose();
    } catch (err) {
      toast.error('Could not duplicate that', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const signedAmount =
    isTransfer || meta.isPersonal
      ? transaction.amountMinor
      : meta.isIncome
        ? transaction.amountMinor
        : -transaction.amountMinor;

  return (
    <>
      <Sheet open onClose={onClose} title={meta.label} size="md" busy={busy}>
        <div className="flex flex-col gap-5 pb-2">
          <div className="flex items-center gap-4 rounded-lg border border-line bg-sunken p-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-md"
              style={
                transaction.categoryColor
                  ? { backgroundColor: `${transaction.categoryColor}1F`, color: transaction.categoryColor }
                  : undefined
              }
            >
              {!transaction.categoryColor ? (
                <span
                  className={cn(
                    'flex size-full items-center justify-center rounded-md',
                    meta.tone === 'positive' && 'bg-positive-soft text-positive',
                    meta.tone === 'negative' && 'bg-negative-soft text-negative',
                    meta.tone === 'neutral' && 'bg-neutral-soft text-ink-secondary',
                  )}
                >
                  <Icon name={transaction.categoryIcon ?? meta.icon} className="size-5" />
                </span>
              ) : (
                <Icon name={transaction.categoryIcon ?? meta.icon} className="size-5" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <Money
                amountMinor={signedAmount}
                size="xl"
                tone={isTransfer || meta.isPersonal ? 'neutral' : 'auto'}
                signed={!isTransfer && !meta.isPersonal}
              />
              <p className="mt-1 truncate text-[13px] text-ink-muted">
                {transaction.description || transaction.categoryName || meta.label}
              </p>
            </div>
          </div>

          {isTransfer && (
            <p className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              This is an internal transfer between your own accounts. It does not count
              towards income, expenses or your savings rate.
            </p>
          )}

          {isLoan && transaction.outstandingMinor !== undefined && (
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="label-eyebrow">Outstanding</span>
                {transaction.isSettled ? (
                  <Badge tone="positive">Fully settled</Badge>
                ) : (
                  <Badge tone="warning">Partly repaid</Badge>
                )}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <Money amountMinor={transaction.outstandingMinor} size="lg" tone="neutral" compactDecimals />
                <span className="sensitive text-[12px] text-ink-muted">
                  of{' '}
                  <Money
                    amountMinor={transaction.amountMinor}
                    size="xs"
                    tone="inherit"
                    weight="medium"
                    compactDecimals
                  />
                </span>
              </div>

              {/* Progress is the fastest read of "how much is left". */}
              <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div
                  className="h-full rounded-full bg-positive transition-[width] duration-500"
                  style={{
                    width: `${Math.round(((transaction.amountMinor - transaction.outstandingMinor) / transaction.amountMinor) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          <dl className="flex flex-col divide-y divide-line-faint rounded-lg border border-line">
            <DetailRow label="Date">
              {formatDate(transaction.date, 'dd MMM yyyy')} · {formatTime(transaction.date)}
            </DetailRow>

            {isTransfer ? (
              <>
                <DetailRow label="From">
                  {transaction.postings.find((p) => p.amountMinor < 0)?.accountName ?? '—'}
                </DetailRow>
                <DetailRow label="To">
                  {transaction.postings.find((p) => p.amountMinor > 0)?.accountName ?? '—'}
                </DetailRow>
              </>
            ) : (
              <DetailRow label="Account">
                {transaction.accountId ? (
                  <Link
                    to={`/accounts/${transaction.accountId}`}
                    onClick={onClose}
                    className="text-gold underline-offset-4 hover:underline"
                  >
                    {transaction.accountName}
                  </Link>
                ) : (
                  transaction.accountName ?? '—'
                )}
              </DetailRow>
            )}

            {transaction.categoryName && (
              <DetailRow label="Category">
                {transaction.categoryName}
                {transaction.subcategoryName ? ` · ${transaction.subcategoryName}` : ''}
              </DetailRow>
            )}

            {transaction.personName && (
              <DetailRow label="Person">
                <Link
                  to={`/people/${transaction.personId}`}
                  onClick={onClose}
                  className="text-gold underline-offset-4 hover:underline"
                >
                  {transaction.personName}
                </Link>
              </DetailRow>
            )}

            {transaction.dueDate && (
              <DetailRow label="Due">{formatDate(transaction.dueDate, 'dd MMM yyyy')}</DetailRow>
            )}

            {transaction.paymentMethod && (
              <DetailRow label="Payment method">
                {PAYMENT_METHOD_LABELS[transaction.paymentMethod]}
              </DetailRow>
            )}

            {transaction.referenceNo && (
              <DetailRow label="Reference">{transaction.referenceNo}</DetailRow>
            )}

            {transaction.tags.length > 0 && (
              <DetailRow label="Tags">
                <span className="flex flex-wrap justify-end gap-1">
                  {transaction.tags.map((tag) => (
                    <Badge key={tag} tone="outline">
                      {tag}
                    </Badge>
                  ))}
                </span>
              </DetailRow>
            )}

            {transaction.notes && <DetailRow label="Notes">{transaction.notes}</DetailRow>}

            <DetailRow label="Recorded" muted>
              {formatDate(transaction.createdAt, 'dd MMM yyyy')} · {formatTime(transaction.createdAt)}
            </DetailRow>

            {transaction.updatedAt !== transaction.createdAt && (
              <DetailRow label="Last edited" muted>
                {formatDate(transaction.updatedAt, 'dd MMM yyyy')} · {formatTime(transaction.updatedAt)}
              </DetailRow>
            )}
          </dl>

          {!transaction.deletedAt && <AttachmentList transactionId={transaction.id} attachments={transaction.attachments} />}

          <div className="flex flex-wrap gap-2">
            {transaction.deletedAt ? (
              <Button
                variant="secondary"
                leftIcon={<RotateCcw className="size-4" />}
                loading={busy}
                onClick={() => void restore()}
              >
                Restore
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  leftIcon={<Copy className="size-4" />}
                  loading={busy}
                  onClick={() => void duplicate()}
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  leftIcon={<Trash2 className="size-4" />}
                  className="text-negative hover:bg-negative-soft"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this transaction?"
        description="Balances will be adjusted straight away. You can undo this for a short while afterwards, and it stays recoverable from the deleted list."
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
      />
    </>
  );
}

function DetailRow({
  label,
  children,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-3">
      <dt className="shrink-0 text-[12.5px] text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-right text-[13px]',
          muted ? 'text-ink-muted' : 'font-medium text-ink',
        )}
      >
        {children}
      </dd>
    </div>
  );
}
