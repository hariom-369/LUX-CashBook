import { useEffect, useState } from 'react';
import type { ProjectDto } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { usePeople } from '../../lib/queries';
import { useInvalidateInvoicing } from '../../lib/queries4';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

/** Create/edit a project (§Phase 11) — the thing invoices and billable expenses attach to. */
export function ProjectFormSheet({ open, project, onClose }: { open: boolean; project: ProjectDto | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidateInvoicing();
  const { data: customers = [] } = usePeople({ relationship: 'customer' });
  const isEdit = Boolean(project);

  const [name, setName] = useState('');
  const [personId, setPersonId] = useState('');
  const [budgetMinor, setBudgetMinor] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(project?.name ?? '');
    setPersonId(project?.personId ?? '');
    setBudgetMinor(project?.budgetMinor ?? null);
    setNotes(project?.notes ?? '');
  }, [open, project]);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), personId: personId || null, budgetMinor, notes: notes || undefined };
      if (project) {
        await patchOrQueue(`/projects/${project.id}`, { ...payload, rev: project.rev });
        toast.success(t('invoicing.projectUpdated'));
      } else {
        if (await createOrQueue('/projects', payload)) toast.success(t('invoicing.projectCreated'));
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
      title={isEdit ? t('invoicing.editProject') : t('invoicing.newProject')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {isEdit ? t('common.saveChanges') : t('invoicing.createProject')}
          </Button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <Field label={t('invoicing.projectName')} required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
        </Field>

        <Field label={t('invoicing.client')} hint={t('invoicing.optionalWhoThisProjectIsFor')}>
          {({ id }) => (
            <Select id={id} value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">{t('invoicing.noClientSet')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t('invoicing.budget')} hint={t('invoicing.optionalForYourOwnReferenceOnly')}>
          {({ id }) => <MoneyInput id={id} value={budgetMinor} onChange={setBudgetMinor} />}
        </Field>

        <Field label={t('common.notes')}>
          {({ id }) => <Textarea id={id} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </form>
    </Sheet>
  );
}
