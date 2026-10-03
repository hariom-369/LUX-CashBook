import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { INDIAN_STATES, PERSON_RELATIONSHIPS, PERSON_RELATIONSHIP_LABELS, type PersonDto } from '@khata/shared';
import { cn } from '../../lib/cn';
import { ConfirmDialog, Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useInvalidateLedger } from '../../lib/queries';
import { useAuthStore } from '../../stores/auth.store';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

/**
 * Add or edit a person (§12).
 *
 * The opening balance is the field that makes this app adoptable: almost nobody
 * starts from zero. Someone already owes you ₹6,000 when you install this, and
 * being able to say so — rather than inventing a fake loan transaction — is what
 * lets a real khata be moved across in one sitting.
 */
export function PersonFormSheet({
  open,
  person,
  onClose,
  defaultRelationship = 'friend',
}: {
  open: boolean;
  person: PersonDto | null;
  onClose: () => void;
  /** The relationship a new person starts with — e.g. 'customer' from the Customers page. */
  defaultRelationship?: (typeof PERSON_RELATIONSHIPS)[number];
}) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidateLedger();
  const isEdit = Boolean(person);
  const mode = useAuthStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<(typeof PERSON_RELATIONSHIPS)[number]>('friend');
  const [gstin, setGstin] = useState('');
  const [state, setState] = useState('');
  const [notes, setNotes] = useState('');
  const [openingDirection, setOpeningDirection] = useState<'receivable' | 'payable'>('receivable');
  const [openingAmount, setOpeningAmount] = useState<number | null>(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});

    if (person) {
      setName(person.name);
      setPhone(person.phone ?? '');
      setEmail(person.email ?? '');
      setRelationship(person.relationship);
      setGstin(person.gstin ?? '');
      setState(person.state ?? '');
      setNotes(person.notes ?? '');
      setOpeningDirection(person.openingBalanceMinor < 0 ? 'payable' : 'receivable');
      setOpeningAmount(Math.abs(person.openingBalanceMinor));
    } else {
      setName('');
      setPhone('');
      setEmail('');
      setRelationship(defaultRelationship);
      setGstin('');
      setState('');
      setNotes('');
      setOpeningDirection('receivable');
      setOpeningAmount(0);
    }
  }, [open, person, defaultRelationship]);

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    // The sign carries the meaning: positive = they owe you (ARCHITECTURE §3.3).
    const signed = (openingAmount ?? 0) * (openingDirection === 'payable' ? -1 : 1);

    const payload = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      relationship,
      gstin: gstin.trim() || undefined,
      state: state || undefined,
      notes: notes.trim() || undefined,
      openingBalanceMinor: signed,
    };

    try {
      if (person) {
        await patchOrQueue(`/people/${person.id}`, { ...payload, rev: person.rev });
        toast.success(t('people.personUpdated'));
      } else {
        if (await createOrQueue('/people', payload)) toast.success(t('people.personAdded'), t('people.isInYourLedger', { name: payload.name }));
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
    if (!person) return;
    setBusy(true);
    try {
      await api.delete(`/people/${person.id}`);
      invalidate();
      toast.success(t('people.personRemoved'));
      onClose();
    } catch (err) {
      // The API refuses while a balance is outstanding, and says so.
      toast.error(t('people.couldNotRemoveThisPerson'), errorMessage(err));
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
        title={isEdit ? t('people.editPerson') : t('people.addPerson')}
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
              {isEdit ? t('common.saveChanges') : t('people.addPerson')}
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
                maxLength={80}
                placeholder={t('people.rahulSharma')}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('common.phone')} error={fieldErrors.phone} hint={t('common.optional')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="tel"
                  value={phone}
                  maxLength={24}
                  placeholder="+91 98765 43210"
                  onChange={(event) => setPhone(event.target.value)}
                />
              )}
            </Field>

            <Field label={t('people.relationship')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={relationship}
                  onChange={(event) =>
                    setRelationship(event.target.value as (typeof PERSON_RELATIONSHIPS)[number])
                  }
                >
                  {PERSON_RELATIONSHIPS.map((option) => (
                    <option key={option} value={option}>
                      {t.label('relationship', option, PERSON_RELATIONSHIP_LABELS[option])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field label={t('common.email')} error={fieldErrors.email} hint={t('common.optional')}>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                value={email}
                maxLength={254}
                placeholder="rahul@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>

          {mode === 'business' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="GSTIN" hint={t('common.optional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={gstin}
                    maxLength={15}
                    placeholder="29ABCDE1234F1Z5"
                    onChange={(event) => setGstin(event.target.value.toUpperCase())}
                  />
                )}
              </Field>
              <Field label={t('common.state')} hint={t('common.forPlaceOfSupply')}>
                {({ id }) => (
                  <Select id={id} value={state} onChange={(event) => setState(event.target.value)}>
                    <option value="">{t('common.notSet')}</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}

          <div className="rounded-lg border border-line p-4">
            <p className="text-[13px] font-medium text-ink">{t('people.existingBalance')}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              {t('people.ifSomethingIsAlreadyOwedBetween')}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ['receivable', t('people.theyOweMe')],
                  ['payable', t('people.iOweThem')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOpeningDirection(value)}
                  aria-pressed={openingDirection === value}
                  className={cn(
                    'h-10 rounded-md border text-[12.5px] font-medium transition-colors',
                    openingDirection === value
                      ? 'border-gold bg-gold-soft text-gold-strong'
                      : 'border-line bg-surface text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <MoneyInput value={openingAmount} onChange={setOpeningAmount} />
            </div>
          </div>

          <Field label={t('common.notes')} hint={t('common.optional')}>
            {({ id }) => (
              <Textarea
                id={id}
                rows={2}
                maxLength={1000}
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
        title={t('accounts.removeNamed', { name: person?.name ?? t('common.thisPerson') })}
        description={t('people.theirTransactionsStayInYourLedger')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </>
  );
}
