import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { WORKSPACE_ROLE_LABELS, type InvitationDto, type WorkspaceRole } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

type Preview = { workspaceName: string; role: WorkspaceRole; email: string };

/** Shown when `?inviteToken=` is present (the link from the invitation email) — preview, then accept or dismiss. */
export function InvitationPrompt({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Preview>(`/invitations/${token}`)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    setBusy(true);
    try {
      await api.post<InvitationDto>(`/invitations/${token}/accept`);
      toast.success(t('settings.joinedWorkspace'), preview ? t('settings.nowRoleOf', { role: t.label('role', preview.role, WORKSPACE_ROLE_LABELS[preview.role]).toLowerCase(), workspace: preview.workspaceName }) : undefined);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-negative/25 bg-negative-soft px-4 py-3.5 text-[13px] text-negative">
        {error}
        <button type="button" onClick={onDone} className="ml-2 underline">
          {t('common.dismiss')}
        </button>
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gold/30 bg-gold-soft px-4 py-3.5">
      <Mail aria-hidden className="size-5 shrink-0 text-gold-strong" />
      <p className="min-w-0 flex-1 text-[13px] text-ink">
        {t('settings.youVeBeenInvitedToJoin')} <strong>{preview.workspaceName}</strong> {t('settings.as')} {t.label('role', preview.role, WORKSPACE_ROLE_LABELS[preview.role]).toLowerCase()}.
      </p>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" onClick={onDone} disabled={busy}>
          {t('settings.notNow')}
        </Button>
        <Button variant="gold" size="sm" loading={busy} onClick={() => void accept()}>
          {t('settings.accept')}
        </Button>
      </div>
    </div>
  );
}
