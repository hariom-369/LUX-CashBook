import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import type { ExpenseGroupDto, PersonDto } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Field, Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { usePeople } from '../../lib/queries';
import { useInvalidateGroup } from '../../lib/queries3';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

/**
 * Create an expense group (docs/FEATURE_ROADMAP.md Phase 8) — a trip, flatmates, a family — or,
 * given `group`, rename it and add or remove members. Members are People in this workspace:
 * pick existing ones, or type a new name — new names are added to People when the form is
 * saved (never on Cancel), and a name already in People is ticked rather than duplicated.
 * You are always part of every group. The server refuses to remove someone who is part of a
 * recorded expense or payment, and says so here.
 */
export function GroupFormSheet({ open, onClose, group }: { open: boolean; onClose: () => void; group?: ExpenseGroupDto }) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const invalidate = useInvalidateGroup(group?.id);
  const { data: people = [] } = usePeople();

  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  /** Names typed in that aren't in People yet — created on save. */
  const [newNames, setNewNames] = useState<string[]>([]);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setMemberIds(group?.memberPersonIds ?? []);
    setNewNames([]);
    setDraftName('');
    setError(null);
  }, [open, group]);

  function toggle(id: string) {
    setMemberIds((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]));
  }

  /** Adds a typed name: ticks the existing person of that name, or queues a new one. Returns the pending list. */
  function addName(raw: string, pending = newNames): string[] {
    const typed = raw.trim().slice(0, 80);
    if (!typed) return pending;
    const existing = people.find((p) => p.name.trim().toLowerCase() === typed.toLowerCase());
    if (existing) {
      setMemberIds((current) => (current.includes(existing.id) ? current : [...current, existing.id]));
      return pending;
    }
    if (pending.some((n) => n.toLowerCase() === typed.toLowerCase())) return pending;
    return [...pending, typed];
  }

  function addDraft() {
    setNewNames(addName(draftName));
    setDraftName('');
  }

  /**
   * Creates every queued name in People and returns the full member list. Each one moves
   * from "new" to ticked as soon as it exists, so a retry after a failure never creates it twice.
   */
  async function resolveMembers(): Promise<string[]> {
    const pending = addName(draftName);
    const ids = [...memberIds];
    // A typed name matching an existing person was ticked by `addName`; include it here too.
    const match = people.find((p) => p.name.trim().toLowerCase() === draftName.trim().toLowerCase());
    if (match && !ids.includes(match.id)) ids.push(match.id);
    setDraftName('');
    setNewNames(pending);
    for (const personName of pending) {
      const person = await api.post<PersonDto>('/people', { name: personName });
      ids.push(person.id);
      setMemberIds((current) => [...current, person.id]);
      setNewNames((current) => current.filter((n) => n !== personName));
    }
    return ids;
  }

  async function saveChanges(existing: ExpenseGroupDto, finalIds: string[]) {
    if (name.trim() !== existing.name) await api.patch(`/groups/${existing.id}`, { name: name.trim() });
    const added = finalIds.filter((id) => !existing.memberPersonIds.includes(id));
    if (added.length > 0) await api.post(`/groups/${existing.id}/members`, { personIds: added });
    for (const id of existing.memberPersonIds.filter((m) => !finalIds.includes(m))) {
      await api.delete(`/groups/${existing.id}/members/${id}`);
    }
  }

  const memberCount = memberIds.length + newNames.length + (draftName.trim() ? 1 : 0);

  async function submit() {
    if (!name.trim() || memberCount === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const finalIds = await resolveMembers();
      if (group) {
        await saveChanges(group, finalIds);
        toast.success(t('groups.groupUpdated'));
      } else {
        const created = await createOrQueue('/groups', { name: name.trim(), memberPersonIds: finalIds });
        if (created) toast.success(t('groups.groupCreated'));
      }
      invalidate();
      onClose();
    } catch (err) {
      // Some changes may already have been saved before the one that was refused.
      invalidate();
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={group ? t('groups.editGroup') : t('groups.newGroup')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim() || memberCount === 0} onClick={() => void submit()}>
            {group ? t('groups.saveChanges') : t('groups.createGroup')}
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
          <p className="mb-1 text-[13px] font-medium text-ink">{t('common.members')}</p>
          <p className="mb-2 text-[11.5px] text-ink-muted">{t('groups.youAreAlwaysInTheGroup')}</p>
          {(people.length > 0 || newNames.length > 0) && (
            <ul className="mb-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {people.map((person) => (
                <li key={person.id}>
                  <label className="flex items-center gap-3 rounded-md border border-line-faint px-3 py-2.5 hover:bg-sunken">
                    <input
                      type="checkbox"
                      checked={memberIds.includes(person.id)}
                      onChange={() => toggle(person.id)}
                      className="size-4 rounded-sm border-line text-gold focus:ring-gold"
                    />
                    <span className="min-w-0 truncate text-[13px] text-ink">{person.name}</span>
                  </label>
                </li>
              ))}
              {newNames.map((personName) => (
                <li key={`new-${personName}`} className="flex items-center gap-3 rounded-md border border-gold/40 bg-gold-soft px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{personName}</span>
                  <Badge tone="gold" eyebrow>{t('groups.newPerson')}</Badge>
                  <button
                    type="button"
                    onClick={() => setNewNames((current) => current.filter((n) => n !== personName))}
                    aria-label={t('groups.removeName', { name: personName })}
                    className="flex size-8 items-center justify-center rounded-sm text-ink-faint transition-colors hover:text-negative"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Input
              value={draftName}
              maxLength={80}
              aria-label={t('groups.addSomeoneNew')}
              placeholder={t('groups.addSomeoneByName')}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds the name rather than submitting the whole form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDraft();
                }
              }}
            />
            <Button variant="secondary" className="shrink-0" leftIcon={<UserPlus className="size-4" />} disabled={!draftName.trim()} onClick={addDraft}>
              {t('common.add')}
            </Button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-muted">{t('groups.newPeopleAreAddedToPeople')}</p>
        </div>
      </form>
    </Sheet>
  );
}
