import { useEffect, useState } from 'react';
import { toDateKey, type ExpenseGroupDto, type GroupSettlementSuggestionDto } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useAccounts } from '../../lib/queries';
import { useInvalidateGroup } from '../../lib/queries3';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/** `'me'` is you; anything else is a member's person id. */
type MemberKey = 'me' | string;
const keyOf = (id: string | null): MemberKey => id ?? 'me';

/**
 * Record money handed over between two members — all of what's owed, or part
 * of it. When you're one of the two it's also an ordinary repayment in your
 * books, so it asks which account the money moved through. Online only: whether
 * a payment fits depends on the group's balances right now.
 */
export function GroupPaymentSheet({
  group,
  open,
  onClose,
  suggestion,
  suggestions,
}: {
  group: ExpenseGroupDto;
  open: boolean;
  onClose: () => void;
  /** The suggested payment this was opened from, if any — prefills both people and the amount. */
  suggestion: GroupSettlementSuggestionDto | null;
  /** Every outstanding suggestion, to show what's owed for the people chosen. */
  suggestions: GroupSettlementSuggestionDto[];
}) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateGroup(group.id);
  const { data: accounts = [] } = useAccounts();

  const [from, setFrom] = useState<MemberKey>('me');
  const [to, setTo] = useState<MemberKey>('me');
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The first account's id, not the array: `useAccounts()` hands back a fresh array while loading, which would re-run the reset below on every render.
  const defaultAccountId = accounts[0]?.id ?? '';
  const memberKeys: MemberKey[] = ['me', ...group.memberPersonIds];
  const nameOf = (id: MemberKey) =>
    id === 'me' ? t('groups.you') : group.memberNames[group.memberPersonIds.indexOf(id)] ?? t('groups.member2');

  useEffect(() => {
    if (!open) return;
    const first = suggestion ?? suggestions[0] ?? null;
    setFrom(first ? keyOf(first.fromPersonId) : group.memberPersonIds[0] ?? 'me');
    setTo(first ? keyOf(first.toPersonId) : 'me');
    setAmountMinor(first?.amountMinor ?? null);
    setDate(toDateKey(new Date()));
    setNote('');
    setError(null);
    setAccountId((current) => current || defaultAccountId);
    // Prefilled once, when opened — not again whenever the suggestions are refetched, which would wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, suggestion, group.memberPersonIds, defaultAccountId]);

  const owed = suggestions.find((s) => keyOf(s.fromPersonId) === from && keyOf(s.toPersonId) === to)?.amountMinor ?? 0;
  const involvesMe = from === 'me' || to === 'me';
  const canSubmit = Boolean(from !== to && amountMinor && amountMinor > 0 && (!involvesMe || accountId));

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/groups/${group.id}/settlements`,
        {
          fromPersonId: from === 'me' ? null : from,
          toPersonId: to === 'me' ? null : to,
          amountMinor,
          date: new Date(`${date}T12:00:00`).toISOString(),
          accountId: involvesMe ? accountId : null,
          note: note.trim() || undefined,
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      invalidate();
      toast.success(amountMinor === owed ? t('groups.paymentRecordedSettled') : t('groups.paymentRecorded'));
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('groups.recordAPayment')}
      description={t('groups.recordAllOrPartOfWhatsOwed')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            {t('groups.recordPayment')}
          </Button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('groups.whoPaid')} required>
            {({ id }) => (
              <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
                {memberKeys.map((k) => (
                  <option key={k} value={k}>{nameOf(k)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('groups.paidTo')} required>
            {({ id }) => (
              <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>
                {memberKeys.map((k) => (
                  <option key={k} value={k}>{nameOf(k)}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label={t('reminders.form.amount')}
          required
          hint={
            from === to ? t('groups.chooseTwoDifferentPeople') : owed > 0 ? (
              <span>
                {t('groups.stillOwed')} <Money amountMinor={owed} size="xs" tone="inherit" compactDecimals />{' '}
                <button type="button" className="font-medium text-gold-strong underline-offset-2 hover:underline" onClick={() => setAmountMinor(owed)}>
                  {t('groups.payInFull')}
                </button>
              </span>
            ) : (
              t('groups.nothingIsSuggestedBetweenThese')
            )
          }
        >
          {({ id }) => <MoneyInput id={id} size="hero" value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        {involvesMe && (
          <Field label={from === 'me' ? t('groups.paidFrom') : t('groups.receivedInto')} required>
            {({ id }) => (
              <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label={t('common.date')}>
          {({ id }) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>

        <Field label={t('groups.noteOptional')}>
          {({ id }) => <Input id={id} value={note} maxLength={200} placeholder={t('groups.upiTransfer')} onChange={(e) => setNote(e.target.value)} />}
        </Field>

        {!involvesMe && from !== to && <p className="text-[11.5px] text-ink-muted">{t('groups.betweenOtherMembersNotInYourBooks')}</p>}
      </form>
    </Sheet>
  );
}
