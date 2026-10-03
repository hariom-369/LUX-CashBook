import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Briefcase, Building2, Check, Plus, User, Users } from 'lucide-react';
import { CURRENCIES, INDIAN_STATES, WORKSPACE_ROLE_LABELS, type WorkspaceDto, type WorkspaceMode } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { Sheet, ConfirmDialog } from '../../components/ui/Sheet';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { MembersSheet } from './MembersSheet';
import { InvitationPrompt } from './InvitationPrompt';
import { useT } from '../../i18n';

/**
 * Workspace management (§4, §6).
 *
 * The switcher in the sidebar handles day-to-day switching; this page is where a
 * workspace is created, renamed or set as the default — the configuration side of
 * the Personal/Business split rather than the daily-use side.
 */
export function WorkspaceSettings() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const workspaces = useAuthStore((s) => s.workspaces);
  const activeId = useAuthStore((s) => s.activeWorkspaceId);
  const setWorkspaces = useAuthStore((s) => s.setWorkspaces);
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace);

  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [managingMembers, setManagingMembers] = useState<WorkspaceDto | null>(null);
  const [editingProfile, setEditingProfile] = useState<WorkspaceDto | null>(null);
  const [leaving, setLeaving] = useState<WorkspaceDto | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteToken = searchParams.get('inviteToken');

  function clearInviteToken() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('inviteToken');
      return next;
    });
  }

  async function refresh() {
    const list = await api.get<WorkspaceDto[]>('/workspaces');
    setWorkspaces(list);
  }

  async function createDemo() {
    setBusyId('demo');
    try {
      await api.post('/workspaces/demo');
      await refresh();
      toast.success(t('settings.demoWorkspaceReady'), t('settings.sampleDataYouCanExploreAnd'));
    } catch (err) {
      toast.error(t('settings.couldNotCreateTheDemo'), errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function makeDefault(id: string) {
    setBusyId(id);
    try {
      await api.post(`/workspaces/${id}/default`);
      await refresh();
      toast.success(t('settings.defaultWorkspaceUpdated'));
    } catch (err) {
      toast.error(t('common.couldNotUpdateThat'), errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function open(id: string) {
    if (id === activeId) return;
    await switchWorkspace(id);
    queryClient.clear();
    toast.success(t('settings.switchedWorkspace'));
  }

  async function leave() {
    if (!leaving) return;
    setBusyId(leaving.id);
    try {
      await api.post(`/workspaces/${leaving.id}/leave`);
      await refresh();
      toast.success(t('settings.leftWorkspace'), t('settings.youNoLongerHaveAccessTo', { name: leaving.name }));
    } catch (err) {
      toast.error(t('settings.couldNotLeaveThatWorkspace'), errorMessage(err));
    } finally {
      setBusyId(null);
      setLeaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {inviteToken && (
        <InvitationPrompt
          token={inviteToken}
          onDone={() => {
            clearInviteToken();
            void refresh();
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13.5px] font-medium text-ink">{t('settings.yourWorkspaces')}</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            {t('settings.personalAndBusinessLedgersAreKept')}
          </p>
        </div>
        <div className="flex gap-2">
          {!workspaces.some((w) => w.isDemo) && (
            <Button size="sm" variant="ghost" loading={busyId === 'demo'} onClick={() => void createDemo()}>
              {t('settings.tryADemoWorkspace')}
            </Button>
          )}
          <Button size="sm" variant="secondary" leftIcon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            {t('common.newWorkspace')}
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-2.5">
        {workspaces.map((workspace) => (
          <li
            key={workspace.id}
            className={cn(
              // Buttons wrap below the name when the row is too narrow for both.
              'flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-lg border p-4',
              workspace.id === activeId ? 'border-gold bg-gold-soft' : 'border-line bg-surface',
            )}
          >
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-md',
                workspace.mode === 'business' ? 'bg-ink text-ink-inverse' : 'bg-sunken text-ink-secondary',
              )}
            >
              {workspace.mode === 'business' ? <Briefcase className="size-4" /> : <User className="size-4" />}
            </span>

            <div className="min-w-0 flex-1 basis-32">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 max-w-full truncate text-[13.5px] font-semibold text-ink">{workspace.name}</span>
                {workspace.isDemo && <Badge tone="info">{t('settings.demo')}</Badge>}
                {workspace.isDefault && <Badge tone="gold">{t('settings.default')}</Badge>}
                {workspace.id === activeId && <Badge tone="positive">{t('settings.active')}</Badge>}
                {workspace.memberCount > 1 && <Badge tone="outline">{t.label('role', workspace.myRole, WORKSPACE_ROLE_LABELS[workspace.myRole])}</Badge>}
              </span>
              <span className="mt-0.5 block text-[11.5px] capitalize text-ink-muted">
                {workspace.mode} · {workspace.currency}
                {workspace.memberCount > 1 && ` ${t('settings.membersCount', { count: workspace.memberCount })}`}
              </span>
            </div>

            <div className="ml-auto flex shrink-0 flex-wrap gap-2">
              {workspace.id !== activeId && (
                <Button variant="secondary" size="sm" onClick={() => void open(workspace.id)}>
                  {t('settings.switchTo')}
                </Button>
              )}
              {!workspace.isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busyId === workspace.id}
                  onClick={() => void makeDefault(workspace.id)}
                >
                  {t('settings.makeDefault')}
                </Button>
              )}
              {workspace.id === activeId && (workspace.myRole === 'owner' || workspace.myRole === 'admin') && (
                <Button variant="ghost" size="sm" leftIcon={<Users className="size-3.5" />} onClick={() => setManagingMembers(workspace)}>
                  {t('common.members')}
                </Button>
              )}
              {workspace.mode === 'business' && (workspace.myRole === 'owner' || workspace.myRole === 'admin') && (
                <Button variant="ghost" size="sm" leftIcon={<Building2 className="size-3.5" />} onClick={() => setEditingProfile(workspace)}>
                  {t('settings.businessProfile')}
                </Button>
              )}
              {workspace.myRole !== 'owner' && (
                <Button variant="ghost" size="sm" loading={busyId === workspace.id} onClick={() => setLeaving(workspace)}>
                  {t('settings.leave')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <CreateWorkspaceSheet open={creating} onClose={() => setCreating(false)} onCreated={refresh} />

      {managingMembers && (
        <MembersSheet
          open={Boolean(managingMembers)}
          onClose={() => setManagingMembers(null)}
          workspaceName={managingMembers.name}
        />
      )}

      <BusinessProfileSheet
        open={Boolean(editingProfile)}
        workspace={editingProfile}
        onClose={() => setEditingProfile(null)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={Boolean(leaving)}
        onCancel={() => setLeaving(null)}
        onConfirm={leave}
        title={t('settings.leave2', { name: leaving?.name ?? '' })}
        description={t('settings.youLoseAccessToThisWorkspace')}
        confirmLabel={t('settings.leave')}
        tone="danger"
        busy={busyId === leaving?.id}
      />
    </div>
  );
}

function CreateWorkspaceSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<WorkspaceMode>('personal');
  const [currency, setCurrency] = useState('INR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/workspaces', { name: name.trim(), mode, currency });
      await onCreated();
      toast.success(t('settings.workspaceCreated'), t('settings.nameIsReady', { name: name.trim() }));
      setName('');
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
      title={t('common.newWorkspace')}
      description={t('settings.aSeparateLedgerWithItsOwn')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim()} onClick={() => void create()}>
            {t('settings.createWorkspace')}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        className="flex flex-col gap-4 pb-2"
      >
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <Field label={t('common.name')} required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />}
        </Field>

        <Field label={t('reminders.form.type')}>
          {({ id }) => (
            <div id={id} className="grid grid-cols-2 gap-2">
              {(['personal', 'business'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  aria-pressed={mode === option}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-[13px] font-medium capitalize transition-colors',
                    mode === option
                      ? 'border-gold bg-gold-soft text-gold-strong'
                      : 'border-line bg-surface text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {mode === option && <Check className="size-3.5" />}
                  {option}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label={t('common.currency')}>
          {({ id }) => (
            <Select id={id} value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {Object.values(CURRENCIES).map((option) => (
                <option key={option.code} value={option.code}>
                  {option.symbol} · {t.label('currency', option.code, option.name)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Sheet>
  );
}

/**
 * Business profile (§Phase 13) — name, address, GSTIN and state. Shown on
 * generated statements and invoice PDFs, and `state` is what decides
 * intra- vs inter-state GST on an invoice (compared against the customer's
 * own state) — see `lib/invoiceMath.ts#splitGst`.
 */
function BusinessProfileSheet({
  open,
  workspace,
  onClose,
  onSaved,
}: {
  open: boolean;
  workspace: WorkspaceDto | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const toast = useToast();
  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusinessName(workspace?.businessName ?? '');
    setBusinessAddress(workspace?.businessAddress ?? '');
    setGstin(workspace?.gstin ?? '');
    setState(workspace?.state ?? '');
  }, [open, workspace]);

  async function save() {
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/workspaces/${workspace.id}`, {
        businessName: businessName.trim() || undefined,
        businessAddress: businessAddress.trim() || undefined,
        gstin: gstin.trim() || undefined,
        state: state || undefined,
      });
      await onSaved();
      toast.success(t('settings.businessProfileUpdated'));
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
      title={t('settings.businessProfile')}
      description={t('settings.shownOnInvoicesAndStatementsState')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} onClick={() => void save()}>
            {t('common.save')}
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
        <Field label={t('settings.businessName')}>
          {({ id }) => <Input id={id} value={businessName} maxLength={120} onChange={(e) => setBusinessName(e.target.value)} />}
        </Field>
        <Field label={t('settings.address')}>
          {({ id }) => <Textarea id={id} rows={2} value={businessAddress} maxLength={400} onChange={(e) => setBusinessAddress(e.target.value)} />}
        </Field>
        <Field label="GSTIN" hint={t('common.optional')}>
          {({ id }) => <Input id={id} value={gstin} maxLength={15} placeholder="29ABCDE1234F1Z5" onChange={(e) => setGstin(e.target.value.toUpperCase())} />}
        </Field>
        <Field label={t('common.state')} hint={t('common.forPlaceOfSupply')}>
          {({ id }) => (
            <Select id={id} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">{t('common.notSet')}</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Sheet>
  );
}
