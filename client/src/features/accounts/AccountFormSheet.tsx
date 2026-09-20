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
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const isEdit = Boolean(account);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [openingBalanceMinor, setOpeningBalanceMinor] = useState<number | null>(0);
  const [bankName, setBankName] = useState('');
  const [last4, setLast4] = useState('');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [blockNegativeBalance, setBlockNegativeBalance] = useState(false);
  const [excludeFromTotals, setExcludeFromTotals] = useState(false);
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
      setColor(account.color);
      setBlockNegativeBalance(account.blockNegativeBalance);
      setExcludeFromTotals(account.excludeFromTotals);
      setNotes(account.notes ?? '');
      setIsActive(account.isActive);
    } else {
      setName('');
      setType('bank');
      setOpeningBalanceMinor(0);
      setBankName('');
      setLast4('');
      setColor(SWATCHES[0]!);
      setBlockNegativeBalance(false);
      setExcludeFromTotals(false);
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
      color,
      blockNegativeBalance,
      excludeFromTotals,
      notes: notes.trim() || undefined,
      ...(isEdit ? { isActive } : {}),
    };

    try {
      if (account) {
        await api.patch(`/accounts/${account.id}`, payload);
        toast.success('Account updated');
      } else {
        await api.post('/accounts', payload);
        toast.success('Account added', `${payload.name} is ready to use.`);
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
          'Account deactivated',
          `${result.transactionCount} transactions were kept and its history is intact.`,
        );
      } else {
        toast.success('Account deleted');
      }
      onClose();
    } catch (err) {
      toast.error('Could not remove that account', errorMessage(err));
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
        title={isEdit ? 'Edit account' : 'Add account'}
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
                Remove
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="gold" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
              {isEdit ? 'Save changes' : 'Add account'}
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

          <Field label="Name" error={fieldErrors.name} required>
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                value={name}
                maxLength={60}
                placeholder="SBI Savings"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          {!isEdit && (
            <Field label="Type" hint="This cannot be changed later.">
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
                        {ACCOUNT_TYPE_META[option].label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}

          <Field
            label="Opening balance"
            error={fieldErrors.openingBalanceMinor}
            hint={
              isEdit
                ? 'Changing this rebuilds every balance derived from it. Transactions are untouched.'
                : 'What is in this account right now, before you record anything.'
            }
          >
            {({ id }) => (
              <MoneyInput id={id} value={openingBalanceMinor} onChange={setOpeningBalanceMinor} />
            )}
          </Field>

          {(type === 'bank' || type === 'credit_card' || type === 'savings') && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank name" hint="Optional">
                {({ id }) => (
                  <Input
                    id={id}
                    value={bankName}
                    maxLength={80}
                    placeholder="State Bank of India"
                    onChange={(event) => setBankName(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Last 4 digits" error={fieldErrors.last4} hint="Optional. Never store the full number.">
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

          <Field label="Colour">
            {({ id }) => (
              <div id={id} className="flex flex-wrap gap-2">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(swatch)}
                    aria-label={`Colour ${swatch}`}
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
              label="Prevent a negative balance"
              hint="Refuse any entry that would take this account below zero. Sensible for cash, not for a credit card."
            />
            <Toggle
              checked={excludeFromTotals}
              onChange={setExcludeFromTotals}
              label="Exclude from totals"
              hint="Keep this account's ledger but leave it out of your total balance and net worth."
            />
            {isEdit && (
              <Toggle
                checked={!isActive}
                onChange={(value) => setIsActive(!value)}
                label="Hide from pickers"
                hint="An inactive account keeps its history but stops appearing when you record a transaction."
              />
            )}
          </div>

          <Field label="Notes" hint="Optional">
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
        title={`Remove ${account?.name ?? 'this account'}?`}
        description="If it has any transactions it will be deactivated instead of deleted, so its history and every balance derived from it stay intact."
        confirmLabel="Remove"
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
