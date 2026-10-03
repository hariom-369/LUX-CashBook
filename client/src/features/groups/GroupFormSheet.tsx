import { useEffect, useState } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { usePeople } from '../../lib/queries';
import { useInvalidateGroup } from '../../lib/queries3';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

/** Create an expense group (docs/FEATURE_ROADMAP.md Phase 8) — a trip, flatmates, a family. Members are People already in this workspace. */
export function GroupFormSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const invalidate = useInvalidateGroup(undefined);
  const { data: people = [] } = usePeople();

  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setMemberIds([]);
    setError(null);
  }, [open]);

  function toggle(id: string) {
    setMemberIds((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]));
  }

  async function submit() {
    if (!name.trim() || memberIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createOrQueue('/groups', { name: name.trim(), memberPersonIds: memberIds });
      invalidate();
      if (created) toast.success(t('groups.groupCreated'));
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
      title={t('groups.newGroup')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim() || memberIds.length === 0} onClick={() => void submit()}>
            {t('groups.createGroup')}
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

        <Field label={t('common.name')} required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={60} placeholder={t('groups.goaTrip')} onChange={(e) => setName(e.target.value)} />}
        </Field>

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">{t('common.members')}</p>
          {people.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">{t('groups.addSomePeopleFirstThenCome')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {people.map((person) => (
                <li key={person.id}>
                  <label className="flex items-center gap-3 rounded-md border border-line-faint px-3 py-2.5 hover:bg-sunken">
                    <input
                      type="checkbox"
                      checked={memberIds.includes(person.id)}
                      onChange={() => toggle(person.id)}
                      className="size-4 rounded-sm border-line text-gold focus:ring-gold"
                    />
                    <span className="text-[13px] text-ink">{person.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Sheet>
  );
}
