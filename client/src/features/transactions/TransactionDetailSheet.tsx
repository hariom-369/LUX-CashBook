import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_META,
  formatDate,
  formatTime,
  toDateKey,
  type TransactionDto,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet, ConfirmDialog } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { TagsInput } from '../../components/ui/TagsInput';
import { useToast } from '../../components/ui/Toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { submitOrQueue } from '../../lib/offlineMutation';
import { useAuthStore } from '../../stores/auth.store';
import { useAccounts, useCategories, useInvalidateLedger, usePayees } from '../../lib/queries';
import { AttachmentList } from './AttachmentList';
import { ReimbursementPanel } from './ReimbursementPanel';
import { useT } from '../../i18n';

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
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  // Leaving edit mode whenever the sheet is closed or a different transaction is
  // opened, rather than only on unmount — this stays one Sheet instance across
  // selections (see TransactionsPage), so state must be reset explicitly.
  useEffect(() => {
    setEditing(false);
  }, [transaction?.id]);

  if (!transaction) return null;

  const meta = TRANSACTION_META[transaction.type];
  const isTransfer = meta.isTransfer;
  const isLoan = transaction.type === 'lend' || transaction.type === 'borrow';

  if (editing) {
    return (
      <EditTransactionForm
        transaction={transaction}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          invalidate();
        }}
        onClose={onClose}
      />
    );
  }

  async function remove() {
    if (!transaction) return;
    setBusy(true);
    try {
      const result = await submitOrQueue({
        method: 'DELETE',
        path: `/transactions/${transaction.id}`,
        body: {},
        workspaceId: activeWorkspaceId,
        userId: currentUserId,
      });
      invalidate();
      onClose();

      if (result.queued) {
        // Nothing has been deleted server-side yet, so there is nothing to "undo".
        toast.success(t('transactions.deleteSavedOffline'), t('transactions.itLlSyncAutomaticallyOnceYou'));
        return;
      }

      toast.undo(t('transactions.transactionDeleted'), async () => {
        try {
          await api.post(`/transactions/${transaction.id}/restore`);
          invalidate();
          toast.success(t('transactions.transactionRestored'));
        } catch (err) {
          toast.error(t('common.couldNotRestoreThat'), errorMessage(err));
        }
      });
    } catch (err) {
      // A loan with repayments cannot be deleted; the API says why, so show that.
      toast.error(t('common.couldNotDeleteThat'), errorMessage(err));
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
      toast.success(t('transactions.transactionRestored'));
      onClose();
    } catch (err) {
      toast.error(t('common.couldNotRestoreThat'), errorMessage(err));
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
      toast.success(t('transactions.duplicated'), t('transactions.aCopyWasAddedWithToday'));
      onClose();
    } catch (err) {
      toast.error(t('transactions.couldNotDuplicateThat'), errorMessage(err));
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
      <Sheet open onClose={onClose} title={t.label('txType', transaction.type, meta.label)} size="md" busy={busy}>
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
                className="max-sm:text-[length:clamp(1.375rem,7.5vw,1.75rem)]"
              />
              {/* This is the one place the full description is shown, so on a phone it wraps rather than truncating. */}
              <p className="mt-1 truncate text-[13px] text-ink-muted max-sm:whitespace-normal max-sm:break-words">
                {transaction.description || transaction.categoryName || t.label('txType', transaction.type, meta.label)}
              </p>
            </div>
          </div>

          {isTransfer && (
            <p className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              {t('transactions.thisIsAnInternalTransferBetween')}
            </p>
          )}

          {isLoan && transaction.outstandingMinor !== undefined && (
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="label-eyebrow">{t('common.outstanding')}</span>
                {transaction.isSettled ? (
                  <Badge tone="positive">{t('transactions.fullySettled')}</Badge>
                ) : (
                  <Badge tone="warning">{t('transactions.partlyRepaid')}</Badge>
                )}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <Money amountMinor={transaction.outstandingMinor} size="lg" tone="neutral" compactDecimals />
                <span className="sensitive text-[12px] text-ink-muted">
                  {t('common.of')}{' '}
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
            <DetailRow label={t('common.date')}>
              {formatDate(transaction.date, 'dd MMM yyyy')} · {formatTime(transaction.date)}
            </DetailRow>

            {isTransfer ? (
              <>
                <DetailRow label={t('transactions.from')}>
                  {transaction.postings.find((p) => p.amountMinor < 0)?.accountName ?? '—'}
                </DetailRow>
                <DetailRow label={t('transactions.to')}>
                  {transaction.postings.find((p) => p.amountMinor > 0)?.accountName ?? '—'}
                </DetailRow>
              </>
            ) : (
              <DetailRow label={t('common.account')}>
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
              <DetailRow label={t('common.category')}>
                {transaction.categoryName}
                {transaction.subcategoryName ? ` · ${transaction.subcategoryName}` : ''}
              </DetailRow>
            )}

            {transaction.personName && (
              <DetailRow label={t('common.person')}>
                <Link
                  to={`/people/${transaction.personId}`}
                  onClick={onClose}
                  className="text-gold underline-offset-4 hover:underline"
                >
                  {transaction.personName}
                </Link>
              </DetailRow>
            )}

            {transaction.payeeName && <DetailRow label={t('common.payee')}>{transaction.payeeName}</DetailRow>}

            {transaction.dueDate && (
              <DetailRow label={t('common.due')}>{formatDate(transaction.dueDate, 'dd MMM yyyy')}</DetailRow>
            )}

            {transaction.paymentMethod && (
              <DetailRow label={t('transactions.paymentMethod')}>
                {t.label('paymentMethod', transaction.paymentMethod, PAYMENT_METHOD_LABELS[transaction.paymentMethod])}
              </DetailRow>
            )}

            {transaction.referenceNo && (
              <DetailRow label={t('transactions.reference')}>{transaction.referenceNo}</DetailRow>
            )}

            {transaction.tags.length > 0 && (
              <DetailRow label={t('common.tags')}>
                <span className="flex flex-wrap justify-end gap-1">
                  {transaction.tags.map((tag) => (
                    <Badge key={tag} tone="outline">
                      {tag}
                    </Badge>
                  ))}
                </span>
              </DetailRow>
            )}

            {transaction.notes && <DetailRow label={t('common.notes')}>{transaction.notes}</DetailRow>}

            <DetailRow label={t('transactions.recorded')} muted>
              {formatDate(transaction.createdAt, 'dd MMM yyyy')} · {formatTime(transaction.createdAt)}
            </DetailRow>

            {transaction.updatedAt !== transaction.createdAt && (
              <DetailRow label={t('transactions.lastEdited')} muted>
                {formatDate(transaction.updatedAt, 'dd MMM yyyy')} · {formatTime(transaction.updatedAt)}
              </DetailRow>
            )}
          </dl>

          {!transaction.deletedAt && <ReimbursementPanel transaction={transaction} onChanged={() => invalidate()} />}

          {!transaction.deletedAt && <AttachmentList transactionId={transaction.id} attachments={transaction.attachments} />}

          <div className="flex flex-wrap gap-2">
            {transaction.deletedAt ? (
              <Button
                variant="secondary"
                leftIcon={<RotateCcw className="size-4" />}
                loading={busy}
                onClick={() => void restore()}
              >
                {t('common.restore')}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  leftIcon={<Pencil className="size-4" />}
                  onClick={() => setEditing(true)}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<Copy className="size-4" />}
                  loading={busy}
                  onClick={() => void duplicate()}
                >
                  {t('transactions.duplicate')}
                </Button>
                <Button
                  variant="ghost"
                  leftIcon={<Trash2 className="size-4" />}
                  className="text-negative hover:bg-negative-soft"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t('common.delete')}
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
        title={t('transactions.deleteThisTransaction')}
        description={t('transactions.balancesWillBeAdjustedStraightAway')}
        confirmLabel={t('common.delete')}
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

/**
 * The edit form (§25, closes audit finding U-6 — transactions previously had no
 * in-app edit at all, only delete/restore/duplicate).
 *
 * Type and person are never editable here: a transaction's type is immutable
 * server-side, and reassigning the person on a loan would rewrite whose ledger
 * it belongs to — both match `updateTransactionSchema` exactly, so nothing this
 * form can submit is rejected as out of scope.
 */
function EditTransactionForm({
  transaction,
  onCancel,
  onSaved,
  onClose,
}: {
  transaction: TransactionDto;
  onCancel: () => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const meta = TRANSACTION_META[transaction.type];
  const isTransfer = meta.isTransfer;
  const isPersonal = meta.isPersonal;
  const isLoan = transaction.type === 'lend' || transaction.type === 'borrow';

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories(meta.isIncome ? 'income' : 'expense');

  const [amountMinor, setAmountMinor] = useState<number | null>(transaction.amountMinor);
  const [date, setDate] = useState(toDateKey(new Date(transaction.date)));
  const [accountId, setAccountId] = useState(transaction.accountId ?? transaction.postings[0]?.accountId ?? '');
  const [toAccountId, setToAccountId] = useState(transaction.toAccountId ?? '');
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? '');
  const [payeeId, setPayeeId] = useState(transaction.payeeId ?? '');
  const { data: payees = [] } = usePayees();
  const [description, setDescription] = useState(transaction.description);
  const [notes, setNotes] = useState(transaction.notes ?? '');
  const [paymentMethod, setPaymentMethod] = useState(transaction.paymentMethod ?? '');
  const [referenceNo, setReferenceNo] = useState(transaction.referenceNo ?? '');
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const [tags, setTags] = useState<string[]>(transaction.tags);
  const [dueDate, setDueDate] = useState(transaction.dueDate ? toDateKey(new Date(transaction.dueDate)) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const flatCategories = useMemo(
    () =>
      categories.flatMap((category) => [
        { id: category.id, name: category.name, depth: 0 },
        ...(category.children ?? []).map((child) => ({ id: child.id, name: child.name, depth: 1 })),
      ]),
    [categories],
  );

  async function save() {
    if (!amountMinor || amountMinor <= 0 || !accountId) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await submitOrQueue({
        method: 'PATCH',
        path: `/transactions/${transaction.id}`,
        rev: transaction.rev,
        workspaceId: activeWorkspaceId,
        userId: currentUserId,
        body: {
          rev: transaction.rev,
          amountMinor,
          date: new Date(`${date}T12:00:00`).toISOString(),
          accountId,
          ...(isTransfer ? { toAccountId } : {}),
          ...(isPersonal ? {} : { categoryId: categoryId || null }),
          ...(isPersonal || isTransfer ? {} : { payeeId: payeeId || null }),
          description: description.trim(),
          notes: notes.trim() || undefined,
          paymentMethod: paymentMethod || undefined,
          referenceNo: referenceNo.trim() || undefined,
          tags,
          ...(isLoan ? { dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null } : {}),
        },
      });
      if (result.queued && result.conflict) toast.error(t('transactions.someoneElseChangedThisFirst'), t('transactions.yourEditWasKeptReviewIt'));
      else if (result.queued) toast.success(t('transactions.editSavedOffline'), t('transactions.itLlSyncAutomaticallyOnceYou'));
      else toast.success(t('transactions.transactionUpdated'));
      onSaved();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'STALE_REVISION') {
          setError(err.message);
        } else if (err.fields.length) {
          setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
          setError(err.message);
        } else {
          setError(err.message);
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('transactions.editType', { type: t.label('txType', transaction.type, meta.label).toLowerCase() })}
      size="md"
      busy={busy}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="gold"
            loading={busy}
            disabled={!amountMinor || amountMinor <= 0 || !accountId}
            onClick={() => void save()}
          >
            {t('common.saveChanges')}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="rounded-md border border-negative/30 bg-negative-soft px-3.5 py-2.5 text-[12.5px] text-negative">
            {error}
          </p>
        )}

        <Field label={t('reminders.form.amount')} required error={fieldErrors.amountMinor}>
          {({ id, describedBy, invalid }) => (
            <MoneyInput id={id} value={amountMinor} onChange={setAmountMinor} aria-describedby={describedBy} invalid={invalid} />
          )}
        </Field>

        <div className={cn('grid grid-cols-1 gap-4', isTransfer && 'sm:grid-cols-2')}>
          <Field label={isTransfer ? t('goals.fromAccount') : t('common.account')} required error={fieldErrors.accountId}>
            {({ id }) => (
              <Select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {isTransfer && (
            <Field label={t('common.toAccount')} required error={fieldErrors.toAccountId}>
              {({ id }) => (
                <Select id={id} value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                  {accounts
                    .filter((account) => account.id !== accountId)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {!isPersonal && !isTransfer && (
          <Field label={t('common.payee')}>
            {({ id }) => (
              <Select id={id} value={payeeId} onChange={(event) => setPayeeId(event.target.value)}>
                <option value="">{t('transactions.noPayee')}</option>
                {payees.map((payee) => (
                  <option key={payee.id} value={payee.id}>
                    {payee.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {!isPersonal && (
          <Field label={t('common.category')} error={fieldErrors.categoryId}>
            {({ id }) => (
              <Select id={id} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">{t('common.uncategorised')}</option>
                {flatCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.depth ? `\u00A0\u00A0\u00A0${category.name}` : category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <div className={cn('grid grid-cols-1 gap-4', isLoan && 'sm:grid-cols-2')}>
          <Field label={t('common.date')} error={fieldErrors.date}>
            {({ id }) => <Input id={id} type="date" value={date} onChange={(event) => setDate(event.target.value)} />}
          </Field>
          {isLoan && (
            <Field label={t('reminders.form.due')} hint={t('reminders.form.amountHint')}>
              {({ id }) => <Input id={id} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />}
            </Field>
          )}
        </div>

        <Field label={t('common.description')} error={fieldErrors.description}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={description}
              maxLength={200}
              aria-describedby={describedBy}
              invalid={invalid}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('transactions.paymentMethod')}>
            {({ id }) => (
              <Select id={id} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="">{t('transactions.notSpecified')}</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t.label('paymentMethod', method, PAYMENT_METHOD_LABELS[method])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('transactions.reference')} hint={t('reminders.form.amountHint')} error={fieldErrors.referenceNo}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={referenceNo}
                maxLength={60}
                aria-describedby={describedBy}
                invalid={invalid}
                onChange={(event) => setReferenceNo(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label={t('common.tags')}>{({ id }) => <TagsInput id={id} value={tags} onChange={setTags} />}</Field>

        <Field label={t('common.notes')} hint={t('reminders.form.amountHint')} error={fieldErrors.notes}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              value={notes}
              maxLength={2000}
              aria-describedby={describedBy}
              invalid={invalid}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}
