import { useEffect, useState } from 'react';
import { toDateKey, type GoalProgressDto } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useInvalidatePlanning } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

export function ContributeSheet({ goal, onClose }: { goal: GoalProgressDto | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidatePlanning();

  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [date, setDate] = useState(toDateKey(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!goal) return;
    setAmountMinor(null);
    setDate(toDateKey(new Date()));
    setNote('');
    setError(null);
  }, [goal]);

  if (!goal) return null;

  async function submit() {
    if (!amountMinor || amountMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/goals/${goal!.id}/contributions`, {
        amountMinor,
        date: new Date(`${date}T12:00:00`).toISOString(),
        note: note.trim() || undefined,
      });
      invalidate();
      toast.success(t('goals.contributionAdded'), t('goals.towardsGoal', { name: goal!.name }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('goals.addTo', { name: goal.name })}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!amountMinor || amountMinor <= 0} onClick={() => void submit()}>
            {t('goals.addContribution')}
          </Button>
        </div>
      }
    >
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <Field label={t('reminders.form.amount')} required>
          {({ id }) => <MoneyInput id={id} size="hero" autoFocus value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        <Field label={t('common.date')}>
          {({ id }) => <Input id={id} type="date" value={date} max={toDateKey(new Date())} onChange={(event) => setDate(event.target.value)} />}
        </Field>

        <Field label={t('common.note')} hint={t('common.optional')}>
          {({ id }) => <Input id={id} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />}
        </Field>
      </form>
    </Sheet>
  );
}
