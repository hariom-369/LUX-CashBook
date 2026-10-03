import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Trash2, UserMinus } from 'lucide-react';
import { WORKSPACE_ROLES, WORKSPACE_ROLE_LABELS, type WorkspaceRole } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { useMembers, useWorkspaceInvitations } from '../../lib/queries3';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

const ROLE_BADGE: Record<WorkspaceRole, 'gold' | 'positive' | 'neutral' | 'outline'> = {
  owner: 'gold', admin: 'positive', member: 'neutral', viewer: 'outline',
};

/**
 * Members and invitations for the active workspace (docs/FEATURE_ROADMAP.md
 * Phase 9). The invited email must already have a Khata account — this
 * adds someone who's already here rather than also building a parallel
 * invite-to-signup flow (see `ROADMAP_PHASE9_NOTES.md`).
 */
export function MembersSheet({ open, onClose, workspaceName }: { open: boolean; onClose: () => void; workspaceName: string }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const workspaces = useAuthStore((s) => s.workspaces);
  const activeId = useAuthStore((s) => s.activeWorkspaceId);
  const myRole = workspaces.find((w) => w.id === activeId)?.myRole ?? 'member';
  const canManage = myRole === 'owner' || myRole === 'admin';

  const { data: members = [] } = useMembers();
  const { data: invitations = [] } = useWorkspaceInvitations();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [activeId, 'members'] });
    void queryClient.invalidateQueries({ queryKey: [activeId, 'workspace-invitations'] });
  }

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/workspace-invitations', { email: email.trim(), role });
      invalidate();
      toast.success(t('settings.invitationSent'), t('settings.canAcceptOnceSignIn', { email: email.trim() }));
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, newRole: WorkspaceRole) {
    try {
      await api.patch(`/members/${userId}`, { role: newRole });
      invalidate();
      toast.success(t('settings.roleUpdated'));
    } catch (err) {
      toast.error(t('settings.couldNotUpdateThatRole'), errorMessage(err));
    }
  }

  async function removeMember() {
    if (!removing) return;
    try {
      await api.delete(`/members/${removing.userId}`);
      invalidate();
      toast.success(t('settings.memberRemoved'));
    } catch (err) {
      toast.error(t('settings.couldNotRemoveThatMember'), errorMessage(err));
    } finally {
      setRemoving(null);
    }
  }

  async function revokeInvitation(id: string) {
    try {
      await api.delete(`/workspace-invitations/${id}`);
      invalidate();
      toast.success(t('settings.invitationRevoked'));
    } catch (err) {
      toast.error(t('settings.couldNotRevokeThat'), errorMessage(err));
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={t('settings.membersOf', { workspaceName })} size="md">
        <div className="flex flex-col gap-5 pb-2">
          {canManage && (
            <div className="rounded-lg border border-line-faint p-3.5">
              <p className="text-[12.5px] font-medium text-ink">{t('settings.inviteSomeone')}</p>
              {error && <p className="mt-1.5 text-[12px] text-negative">{error}</p>}
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Field label={t('common.email')} className="flex-1">
                  {({ id }) => <Input id={id} type="email" value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />}
                </Field>
                <Field label={t('settings.role')}>
                  {({ id }) => (
                    <Select id={id} value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
                      {WORKSPACE_ROLES.filter((r) => r !== 'owner').map((r) => (
                        <option key={r} value={r}>{t.label('role', r, WORKSPACE_ROLE_LABELS[r])}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button variant="gold" loading={busy} disabled={!email.trim()} leftIcon={<Plus className="size-3.5" />} onClick={() => void invite()}>
                  {t('settings.invite')}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-ink-muted">{t('settings.theyNeedAKhataAccountWith')}</p>
            </div>
          )}

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">{t('common.members')}</p>
            <ul className="mt-2 flex flex-col divide-y divide-line-faint">
              {members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">{member.name}{member.userId === user?.id && ' (you)'}</p>
                    <p className="truncate text-[11.5px] text-ink-muted">{member.email}</p>
                  </div>
                  {canManage && member.role !== 'owner' && member.userId !== user?.id ? (
                    <>
                      <Select
                        aria-label={t('settings.roleFor', { name: member.name })}
                        value={member.role}
                        onChange={(e) => void changeRole(member.userId, e.target.value as WorkspaceRole)}
                        className="w-auto"
                      >
                        {WORKSPACE_ROLES.filter((r) => r !== 'owner' && (r !== 'admin' || myRole === 'owner')).map((r) => (
                          <option key={r} value={r}>{t.label('role', r, WORKSPACE_ROLE_LABELS[r])}</option>
                        ))}
                      </Select>
                      {(member.role !== 'admin' || myRole === 'owner') && (
                        <button
                          type="button"
                          onClick={() => setRemoving({ userId: member.userId, name: member.name })}
                          aria-label={t('settings.remove', { name: member.name })}
                          className="rounded-sm p-2 text-ink-faint transition-colors hover:text-negative"
                        >
                          <UserMinus aria-hidden className="size-4" />
                        </button>
                      )}
                    </>
                  ) : (
                    <Badge tone={ROLE_BADGE[member.role]}>{t.label('role', member.role, WORKSPACE_ROLE_LABELS[member.role])}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {canManage && invitations.length > 0 && (
            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">{t('settings.pendingInvitations')}</p>
              <ul className="mt-2 flex flex-col divide-y divide-line-faint">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="flex items-center gap-3 py-2.5">
                    <Mail aria-hidden className="size-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{invitation.email}</p>
                      <p className="text-[11px] text-ink-muted">{t('settings.invitedAs')} {t.label('role', invitation.role, WORKSPACE_ROLE_LABELS[invitation.role])}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokeInvitation(invitation.id)}
                      aria-label={t('settings.revokeInvitationTo', { email: invitation.email })}
                      className="rounded-sm p-2 text-ink-faint transition-colors hover:text-negative"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(removing)}
        onCancel={() => setRemoving(null)}
        onConfirm={removeMember}
        title={t('settings.remove2', { name: removing?.name ?? '' })}
        description={t('settings.theyLoseAccessToThisWorkspace')}
        confirmLabel={t('common.remove')}
        tone="danger"
      />
    </>
  );
}
