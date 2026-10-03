import { useEffect, useState } from 'react';
import { GOAL_ICONS, toDateKey, type GoalProgressDto } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { useAccounts } from '../../lib/queries';
import { useInvalidatePlanning } from '../../lib/queries3';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

const SWATCHES = ['#B08D4F', '#2F7A5C', '#3F6383', '#A8443C', '#8A6BA8', '#9A7420'];

export function GoalFormSheet({
  open,
  goal,
  onClose,
}: {
  open: boolean;
  goal: GoalProgressDto | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidatePlanning();
  const { data: accounts = [] } = useAccounts();
  const isEdit = Boolean(goal);

  const [name, setName] = useState('');
  const [targetMinor, setTargetMinor] = useState<number | null>(null);
  const [targetDate, setTargetDate] = useState('');
  const [icon, setIcon] = useState('Target');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (goal) {
      setName(goal.name);
      setTargetMinor(goal.targetMinor);
      setTargetDate(goal.targetDate ? toDateKey(new Date(goal.targetDate)) : '');
      setIcon(goal.icon);
      setColor(goal.color);
      setLinkedAccountId(goal.linkedAccountId ?? '');
    } else {
      setName('');
      setTargetMinor(null);
      setTargetDate('');
      setIcon('Target');
      setColor(SWATCHES[0]!);
      setLinkedAccountId('');
    }
  }, [open, goal]);

  async function save() {
    if (!name.trim() || !targetMinor || targetMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        targetMinor,
        targetDate: targetDate ? new Date(`${targetDate}T12:00:00`).toISOString() : null,
        icon,
        color,
        linkedAccountId: linkedAccountId || null,
      };
      if (goal) {
        await patchOrQueue(`/goals/${goal.id}`, { ...payload, rev: goal.rev });
        toast.success(t('goals.goalUpdated'));
      } else {
        if (await createOrQueue('/goals', payload)) toast.success(t('goals.goalCreated'));
      }
      invalidate();
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
      title={isEdit ? t('goals.editGoal') : t('goals.newGoal')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim() || !targetMinor} onClick={() => void save()}>
            {isEdit ? t('common.saveChanges') : t('goals.createGoal')}
          </Button>
        </div>
      }
    >
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <Field label={t('common.name')} required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={60} placeholder={t('goals.newLaptop')} onChange={(event) => setName(event.target.value)} />}
        </Field>

        <Field label={t('goals.targetAmount')} required>
          {({ id }) => <MoneyInput id={id} size="hero" value={targetMinor} onChange={setTargetMinor} />}
        </Field>

        <Field label={t('goals.targetDate')} hint={t('common.optional')}>
          {({ id }) => <Input id={id} type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />}
        </Field>

        <Field label={t('goals.icon')}>
          {({ id }) => (
            <div id={id} className="grid grid-cols-6 gap-2">
              {GOAL_ICONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setIcon(option)}
                  aria-label={t.label('goalIcon', option, option)}
                  aria-pressed={icon === option}
                  className={cn(
                    'flex items-center justify-center rounded-md border p-2.5 transition-colors',
                    icon === option ? 'border-gold bg-gold-soft text-gold-strong' : 'border-line text-ink-muted hover:bg-sunken',
                  )}
                >
                  <Icon name={option} className="size-4" />
                </button>
              ))}
            </div>
          )}
        </Field>

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
                  className={cn('size-8 rounded-md transition-transform', color === swatch ? 'ring-2 ring-ink ring-offset-2 ring-offset-raised' : 'hover:scale-105')}
                />
              ))}
            </div>
          )}
        </Field>

        <Field label={t('goals.trackAnAccountInstead')} hint={t('goals.progressFollowsThisAccountSBalance')}>
          {({ id }) => (
            <select
              id={id}
              value={linkedAccountId}
              onChange={(event) => setLinkedAccountId(event.target.value)}
              className="h-11 w-full rounded-md border border-line bg-sunken px-3.5 text-[15px] text-ink focus:border-gold focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[--k-gold-ring]"
            >
              <option value="">{t('goals.trackManually')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </form>
    </Sheet>
  );
}
