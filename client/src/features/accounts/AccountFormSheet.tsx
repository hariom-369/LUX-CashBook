import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_META, type AccountDto, type AccountType } from '@khata/shared';
import { cn } from '../../lib/cn';
import { ConfirmDialog, Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useInvalidateLedger } from '../../lib/queries';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

const SWATCHES = [
  '#B08D4F', '#2F7A5C', '#3F6383', '#A8443C', '#8A6BA8',
  '#9A7420', '#5F8BA8', '#8C6E52', '#6F7FA8', '#7E7A73',
];

/**
 * Create or edit an account (§8).
 *
 * The opening balance is only editable at creation in spirit, but the API allows
 * changing it later and rebuilds every derived balance when it does — because
 * people genuinely do mistype it, and the alternative (a fake correcting
 * transaction in their ledger) is worse.
 */
export function AccountFormSheet({
  open,
  account,
  onClose,
}: {
  open: boolean;
  account: AccountDto | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidateLedger();
  const isEdit = Boolean(account);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [openingBalanceMinor, setOpeningBalanceMinor] = useState<number | null>(0);
  const [bankName, setBankName] = useState('');
  const [last4, setLast4] = useState('');
  const [creditLimitMinor, setCreditLimitMinor] = useState<number | null>(null);
  const [statementDay, setStatementDay] = useState<number | ''>('');
  const [dueDay, setDueDay] = useState<number | ''>('');
  const [minimumDueMinor, setMinimumDueMinor] = useState<number | null>(null);
  const [color, setColor] = useState(SWATCHES[0]!);
  const [blockNegativeBalance, setBlockNegativeBalance] = useState(false);
  const [excludeFromTotals, setExcludeFromTotals] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});

    if (account) {
      setName(account.name);
      setType(account.type);
      setOpeningBalanceMinor(account.openingBalanceMinor);
      setBankName(account.bankName ?? '');
      setLast4(account.last4 ?? '');
      setCreditLimitMinor(account.creditLimitMinor ?? null);
      setStatementDay(account.statementDay ?? '');
      setDueDay(account.dueDay ?? '');
      setMinimumDueMinor(account.minimumDueMinor ?? null);
      setColor(account.color);
      setBlockNegativeBalance(account.blockNegativeBalance);
      setExcludeFromTotals(account.excludeFromTotals);
      setIsPrivate(account.visibility === 'private');
      setNotes(account.notes ?? '');
      setIsActive(account.isActive);
    } else {
      setName('');
      setType('bank');
      setOpeningBalanceMinor(0);
      setBankName('');
      setLast4('');
      setCreditLimitMinor(null);
      setStatementDay('');
      setDueDay('');
      setMinimumDueMinor(null);
      setColor(SWATCHES[0]!);
      setBlockNegativeBalance(false);
      setExcludeFromTotals(false);
      setIsPrivate(false);
      setNotes('');
      setIsActive(true);
    }
  }, [open, account]);

  // Cash cannot go below zero in reality, so the guard defaults on for cash and off
  // for a card — the user can still override either.
  useEffect(() => {
    if (!open || isEdit) return;
    setBlockNegativeBalance(type === 'cash');
  }, [type, open, isEdit]);

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      name: name.trim(),
      ...(isEdit ? {} : { type }),
      openingBalanceMinor: openingBalanceMinor ?? 0,
      bankName: bankName.trim() || undefined,
      last4: last4.trim() || undefined,
      ...(type === 'credit_card'
        ? {
            creditLimitMinor: creditLimitMinor ?? undefined,
            statementDay: statementDay || undefined,
            dueDay: dueDay || undefined,
            minimumDueMinor: minimumDueMinor ?? undefined,
          }
        : {}),
      color,
      blockNegativeBalance,
      excludeFromTotals,
      visibility: isPrivate ? 'private' : 'shared',
      notes: notes.trim() || undefined,
      ...(isEdit ? { isActive } : {}),
    };

    try {
      if (account) {
        // `rev` lets the server refuse a stale edit (someone else changed this
        // account after we loaded it) instead of silently overwriting it.
        await patchOrQueue(`/accounts/${account.id}`, { ...payload, rev: account.rev });
        toast.success(t('accounts.accountUpdated'));
      } else {
        if (await createOrQueue('/accounts', payload)) toast.success(t('accounts.accountAdded'), t('accounts.isReadyToUse', { name: payload.name }));
      }
      invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields.length) {
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!account) return;
    setBusy(true);
    try {
      const result = await api.delete<{ deleted: boolean; deactivated: boolean; transactionCount: number }>(
        `/accounts/${account.id}`,
      );
      invalidate();
      // The API deactivates rather than deletes when transactions exist, so say
      // which one actually happened instead of claiming a deletion.
      if (result.deactivated) {
        toast.success(
          t('accounts.accountDeactivated'),
          t('accounts.transactionsWereKeptAndItsHistory', { transactionCount: result.transactionCount }),
        );
      } else {
        toast.success(t('accounts.accountDeleted'));
      }
      onClose();
    } catch (err) {
      toast.error(t('accounts.couldNotRemoveThatAccount'), errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={isEdit ? t('accounts.editAccount') : t('accounts.addAccount')}
        description={
          isEdit ? undefined : 'Where does this money actually sit? You can add as many as you need.'
        }
        size="md"
        busy={busy}
        footer={
          <div className="flex items-center gap-2">
            {isEdit && (
              <Button
                variant="ghost"
                className="text-negative hover:bg-negative-soft"
                leftIcon={<Trash2 className="size-4" />}
                onClick={() => setConfirmDelete(true)}
              >
                {t('common.remove')}
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="gold" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
              {isEdit ? t('common.saveChanges') : t('accounts.addAccount')}
            </Button>
          </div>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="flex flex-col gap-4 pb-2"
        >
          {error && (
            <div
              role="alert"
              className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] leading-relaxed text-negative"
            >
              {error}
            </div>
          )}

          <Field label={t('common.name')} error={fieldErrors.name} required>
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                value={name}
                maxLength={60}
                placeholder={t('accounts.sbiSavings')}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          {!isEdit && (
            <Field label={t('reminders.form.type')} hint={t('accounts.thisCannotBeChangedLater')}>
              {({ id }) => (
                <div id={id} className="grid grid-cols-4 gap-2">
                  {ACCOUNT_TYPES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setType(option)}
                      aria-pressed={type === option}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-md border px-1 py-2.5 transition-colors',
                        type === option
                          ? 'border-gold bg-gold-soft text-gold-strong'
                          : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                      )}
                    >
                      <Icon name={ACCOUNT_TYPE_META[option].icon} aria-hidden className="size-4" />
                      <span className="text-[10.5px] font-medium leading-tight">
                        {t.label('accountType', option, ACCOUNT_TYPE_META[option].label)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}

          <Field
            label={t('common.openingBalance')}
            error={fieldErrors.openingBalanceMinor}
            hint={
              isEdit
                ? t('accounts.changingThisRebuildsEveryBalanceDerived')
                : t('accounts.whatIsInThisAccountRight')
            }
          >
            {({ id }) => (
              <MoneyInput id={id} value={openingBalanceMinor} onChange={setOpeningBalanceMinor} />
            )}
          </Field>

          {(type === 'bank' || type === 'credit_card' || type === 'savings') && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('accounts.bankName')} hint={t('common.optional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={bankName}
                    maxLength={80}
                    placeholder={t('accounts.stateBankOfIndia')}
                    onChange={(event) => setBankName(event.target.value)}
                  />
                )}
              </Field>
              <Field label={t('accounts.last4Digits')} error={fieldErrors.last4} hint={t('accounts.optionalNeverStoreTheFullNumber')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={last4}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="4321"
                    onChange={(event) => setLast4(event.target.value.replace(/\D/g, ''))}
                  />
                )}
              </Field>
            </div>
          )}

          {type === 'credit_card' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('accounts.creditLimit')} hint={t('accounts.optionalUsedForTheUtilisationDisplay')}>
                {({ id }) => <MoneyInput id={id} value={creditLimitMinor} onChange={setCreditLimitMinor} />}
              </Field>
              <Field label={t('accounts.minimumDue')} hint={t('common.optional')}>
                {({ id }) => <MoneyInput id={id} value={minimumDueMinor} onChange={setMinimumDueMinor} />}
              </Field>
              <Field label={t('accounts.statementDay')} hint={t('accounts.dayOfTheMonthOptional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={31}
                    value={statementDay}
                    onChange={(event) => setStatementDay(event.target.value ? Number(event.target.value) : '')}
                  />
                )}
              </Field>
              <Field label={t('accounts.paymentDueDay')} hint={t('accounts.dayOfTheMonthOptionalRaises')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={31}
                    value={dueDay}
                    onChange={(event) => setDueDay(event.target.value ? Number(event.target.value) : '')}
                  />
                )}
              </Field>
            </div>
          )}

          <Field label={t('common.colour')}>
            {({ id }) => (
              <div id={id} className="flex flex-wrap gap-2">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(swatch)}
                    aria-label={t('common.colour2', { swatch })}
                    aria-pressed={color === swatch}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      'size-8 rounded-md transition-[box-shadow,transform]',
                      color === swatch
                        ? 'ring-2 ring-ink ring-offset-2 ring-offset-raised'
                        : 'hover:scale-105',
                    )}
                  />
                ))}
              </div>
            )}
          </Field>

          <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <Toggle
              checked={blockNegativeBalance}
              onChange={setBlockNegativeBalance}
              label={t('accounts.preventANegativeBalance')}
              hint={t('accounts.refuseAnyEntryThatWouldTake')}
            />
            <Toggle
              checked={excludeFromTotals}
              onChange={setExcludeFromTotals}
              label={t('accounts.excludeFromTotals')}
              hint={t('accounts.keepThisAccountSLedgerBut')}
            />
            <Toggle
              checked={isPrivate}
              onChange={setIsPrivate}
              label={t('accounts.privateAccount')}
              hint={t('accounts.inASharedWorkspaceOnlyYou')}
            />
            {isEdit && (
              <Toggle
                checked={!isActive}
                onChange={(value) => setIsActive(!value)}
                label={t('accounts.hideFromPickers')}
                hint={t('accounts.anInactiveAccountKeepsItsHistory')}
              />
            )}
          </div>

          <Field label={t('common.notes')} hint={t('common.optional')}>
            {({ id }) => (
              <Textarea
                id={id}
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            )}
          </Field>
        </form>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={t('accounts.removeNamed', { name: account?.name ?? t('common.thisAccount') })}
        description={t('accounts.ifItHasAnyTransactionsIt')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded-sm border-line text-gold focus:ring-gold"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}
