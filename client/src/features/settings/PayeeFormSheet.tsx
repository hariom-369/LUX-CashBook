import { useEffect, useState } from 'react';
import type { PayeeDto } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { TagsInput } from '../../components/ui/TagsInput';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useCategories, useInvalidateLedger } from '../../lib/queries';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

/** Add or edit a payee (docs/FINANCIAL_MODEL.md, decision 3). */
export function PayeeFormSheet({
  open,
  payee,
  onClose,
}: {
  open: boolean;
  payee: PayeeDto | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const invalidate = useInvalidateLedger();
  const isEdit = Boolean(payee);

  const { data: accounts = [] } = useAccounts();
  const { data: expenseCategories = [] } = useCategories('expense');

  const [name, setName] = useState('');
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [defaultCategoryId, setDefaultCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(payee?.name ?? '');
    setDefaultAccountId(payee?.defaultAccountId ?? '');
    setDefaultCategoryId(payee?.defaultCategoryId ?? '');
    setNotes(payee?.notes ?? '');
    setTags(payee?.tags ?? []);
    setError(null);
    setFieldErrors({});
  }, [open, payee]);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const body = {
      name: name.trim(),
      defaultAccountId: defaultAccountId || null,
      defaultCategoryId: defaultCategoryId || null,
      notes: notes.trim() || undefined,
      tags,
    };

    try {
      if (payee) {
        await api.patch(`/payees/${payee.id}`, body);
        toast.success(t('settings.payeeUpdated'));
      } else {
        if (await createOrQueue('/payees', body)) toast.success(t('settings.payeeAdded'));
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      busy={busy}
      title={isEdit ? t('settings.editPayee') : t('settings.addPayee')}
      description={t('settings.aMerchantOrCounterpartyYouPay')}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {isEdit ? t('common.saveChanges') : t('settings.addPayee')}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void save();
        }}
      >
        {error && (
          <p role="alert" className="rounded-md border border-negative/30 bg-negative-soft px-3.5 py-2.5 text-[12.5px] text-negative">
            {error}
          </p>
        )}

        <Field label={t('common.name')} required error={fieldErrors.name}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} value={name} maxLength={80} autoFocus aria-describedby={describedBy} invalid={invalid} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('settings.defaultAccount')} hint={t('settings.prefilledWhenYouPickThisPayee')}>
            {({ id }) => (
              <Select id={id} value={defaultAccountId} onChange={(event) => setDefaultAccountId(event.target.value)}>
                <option value="">{t('common.none')}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('settings.defaultCategory')} hint={t('settings.expenseOnly')}>
            {({ id }) => (
              <Select id={id} value={defaultCategoryId} onChange={(event) => setDefaultCategoryId(event.target.value)}>
                <option value="">{t('common.none')}</option>
                {expenseCategories.flatMap((category) => [
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>,
                  ...(category.children ?? []).map((child) => (
                    <option key={child.id} value={child.id}>
                      {'   '}
                      {child.name}
                    </option>
                  )),
                ])}
              </Select>
            )}
          </Field>
        </div>

        <Field label={t('common.tags')}>{({ id }) => <TagsInput id={id} value={tags} onChange={setTags} />}</Field>

        <Field label={t('common.notes')} hint={t('reminders.form.amountHint')}>
          {({ id }) => <Textarea id={id} value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />}
        </Field>
      </form>
    </Sheet>
  );
}
