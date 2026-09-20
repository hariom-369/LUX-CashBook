import { useState } from 'react';
import { Briefcase, Check, Plus, User } from 'lucide-react';
import { CURRENCIES, type WorkspaceDto, type WorkspaceMode } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { Sheet } from '../../components/ui/Sheet';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Workspace management (§4, §6).
 *
 * The switcher in the sidebar handles day-to-day switching; this page is where a
 * workspace is created, renamed or set as the default — the configuration side of
 * the Personal/Business split rather than the daily-use side.
 */
export function WorkspaceSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const workspaces = useAuthStore((s) => s.workspaces);
  const activeId = useAuthStore((s) => s.activeWorkspaceId);
  const setWorkspaces = useAuthStore((s) => s.setWorkspaces);
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace);

  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const list = await api.get<WorkspaceDto[]>('/workspaces');
    setWorkspaces(list);
  }

  async function makeDefault(id: string) {
    setBusyId(id);
    try {
      await api.post(`/workspaces/${id}/default`);
      await refresh();
      toast.success('Default workspace updated');
    } catch (err) {
      toast.error('Could not update that', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function open(id: string) {
    if (id === activeId) return;
    await switchWorkspace(id);
    queryClient.clear();
    toast.success('Switched workspace');
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[13.5px] font-medium text-ink">Your workspaces</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            Personal and business ledgers are kept completely separate.
          </p>
        </div>
        <Button size="sm" variant="secondary" leftIcon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          New workspace
        </Button>
      </div>

      <ul className="flex flex-col gap-2.5">
        {workspaces.map((workspace) => (
          <li
            key={workspace.id}
            className={cn(
              'flex items-center gap-3.5 rounded-lg border p-4',
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

            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-semibold text-ink">{workspace.name}</span>
                {workspace.isDefault && <Badge tone="gold">Default</Badge>}
                {workspace.id === activeId && <Badge tone="positive">Active</Badge>}
              </span>
              <span className="mt-0.5 block text-[11.5px] capitalize text-ink-muted">
                {workspace.mode} · {workspace.currency}
              </span>
            </div>

            <div className="flex shrink-0 gap-2">
              {workspace.id !== activeId && (
                <Button variant="secondary" size="sm" onClick={() => void open(workspace.id)}>
                  Switch to
                </Button>
              )}
              {!workspace.isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busyId === workspace.id}
                  onClick={() => void makeDefault(workspace.id)}
                >
                  Make default
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <CreateWorkspaceSheet open={creating} onClose={() => setCreating(false)} onCreated={refresh} />
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
      toast.success('Workspace created', `${name.trim()} is ready.`);
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
      title="New workspace"
      description="A separate ledger with its own accounts, categories and transactions."
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim()} onClick={() => void create()}>
            Create workspace
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

        <Field label="Name" required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />}
        </Field>

        <Field label="Type">
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

        <Field label="Currency">
          {({ id }) => (
            <Select id={id} value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {Object.values(CURRENCIES).map((option) => (
                <option key={option.code} value={option.code}>
                  {option.symbol} · {option.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Sheet>
  );
}
