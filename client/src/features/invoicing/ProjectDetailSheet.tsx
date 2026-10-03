import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { PROJECT_STATUSES, type ProjectDto } from '@khata/shared';
import { Sheet, ConfirmDialog } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useProjectSummary, useInvoices, useInvalidateInvoicing } from '../../lib/queries4';
import { api, errorMessage } from '../../lib/api';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';

/** A project's profit summary (§Phase 11) — live from paid invoices and attributed expenses, never cached. */
export function ProjectDetailSheet({
  open,
  project,
  onClose,
  onEdit,
}: {
  open: boolean;
  project: ProjectDto | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidateInvoicing();
  const { data: summary, isLoading, isError, error } = useProjectSummary(project?.id);
  const { data: invoices = [] } = useInvoices({ projectId: project?.id });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!project) return null;

  async function setStatus(status: string) {
    setBusy(true);
    try {
      await patchOrQueue(`/projects/${project!.id}`, { status, rev: project!.rev });
      invalidate();
    } catch (err) {
      toast.error(t('invoicing.couldNotUpdateStatus'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/projects/${project!.id}`);
      invalidate();
      toast.success(t('invoicing.projectRemoved'));
      onClose();
    } catch (err) {
      toast.error(t('invoicing.couldNotRemoveThisProject'), errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={project.name}
        description={project.personName}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button variant="danger" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setConfirmingDelete(true)}>
              {t('common.delete')}
            </Button>
            <div className="flex items-center gap-2">
              <Select value={project.status} onChange={(e) => void setStatus(e.target.value)} disabled={busy} className="w-auto">
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s[0]!.toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </Select>
              <Button size="sm" leftIcon={<Pencil className="size-3.5" />} onClick={onEdit}>
                {t('common.edit')}
              </Button>
            </div>
          </div>
        }
      >
        {isLoading ? (
          <LoadingState rows={3} />
        ) : isError ? (
          <ErrorState error={error} />
        ) : summary ? (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-3">
              <SummaryCard label={t('invoicing.billed')} amountMinor={summary.billedMinor} tone="positive" />
              <SummaryCard label={t('common.expenses')} amountMinor={summary.expenseMinor} tone="negative" />
              <SummaryCard label={t('invoicing.profit')} amountMinor={summary.profitMinor} tone={summary.profitMinor >= 0 ? 'positive' : 'negative'} />
            </div>

            <div>
              <h3 className="text-[13px] font-medium text-ink">{t('invoicing.invoices')}{invoices.length})</h3>
              {invoices.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-ink-muted">{t('invoicing.noInvoicesAgainstThisProjectYet')}</p>
              ) : (
                <ul className="mt-2 divide-y divide-line-faint rounded-md border border-line">
                  {invoices.map((inv) => (
                    <li key={inv.id}>
                      <Link to="/invoices" className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px] hover:bg-sunken">
                        <span className="font-medium text-ink">{inv.number}</span>
                        <Money amountMinor={inv.totalMinor} size="sm" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={remove}
        busy={busy}
        tone="danger"
        title={t('invoicing.deleteThisProject')}
        description={t('invoicing.thisOnlyRemovesTheProjectItself')}
        confirmLabel={t('common.delete')}
      />
    </>
  );
}

function SummaryCard({ label, amountMinor, tone }: { label: string; amountMinor: number; tone: 'positive' | 'negative' }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3.5 py-3">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1">
        <Money amountMinor={Math.abs(amountMinor)} size="md" tone={tone} compactDecimals />
      </div>
    </div>
  );
}
