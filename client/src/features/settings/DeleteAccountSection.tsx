import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/**
 * Account deletion (§77). The server has always supported it; this is the screen
 * that makes it reachable. Gated exactly as the API is — current password plus
 * the typed word DELETE — and explicit about what goes.
 */
export function DeleteAccountSection() {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setPassword('');
    setConfirmation('');
    setPasswordError(undefined);
  }

  async function deleteAccount() {
    setBusy(true);
    setPasswordError(undefined);
    try {
      await api.post('/users/me/delete', { password, confirmation });
      toast.success(t('account.delete.done'));
      // The server already revoked every session and cleared the cookie; this
      // drops the local session and every cached figure on this device.
      useAuthStore.getState().clear();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'INVALID_CREDENTIALS') {
        setPasswordError(err.message);
      } else {
        toast.error(t('account.delete.failed'), errorMessage(err));
      }
      setBusy(false);
    }
  }

  const canSubmit = password.length > 0 && confirmation === 'DELETE';

  return (
    <section className="border-t border-line-faint pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13.5px] font-medium text-ink">{t('account.delete.title')}</p>
          <p className="mt-1 text-[12px] text-ink-muted">{t('account.delete.description')}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-negative hover:bg-negative-soft"
          leftIcon={<Trash2 className="size-3.5" />}
          onClick={() => setOpen(true)}
        >
          {t('account.delete.action')}
        </Button>
      </div>

      <Sheet
        open={open}
        onClose={close}
        busy={busy}
        size="sm"
        title={t('account.delete.sheetTitle')}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} disabled={!canSubmit} onClick={() => void deleteAccount()}>
              {t('account.delete.submit')}
            </Button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void deleteAccount();
          }}
        >
          <p className="text-[13px] leading-relaxed text-ink-secondary">{t('account.delete.consequences')}</p>
          <p className="rounded-md border border-warning/25 bg-warning-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-secondary">
            {t('account.delete.backupFirst')}
          </p>
          <Field label={t('account.delete.password')} error={passwordError}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                aria-describedby={describedBy}
                invalid={invalid}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('account.delete.confirmLabel')} hint={t('account.delete.confirmHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby={describedBy}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            )}
          </Field>
        </form>
      </Sheet>
    </section>
  );
}
