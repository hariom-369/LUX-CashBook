import { useState } from 'react';
import { CheckCircle2, Stethoscope, TriangleAlert } from 'lucide-react';
import { formatMoney } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import type { IntegrityReport } from '../../lib/queries';
import { useCurrency } from '../../hooks/useCurrency';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n/messages/en';

/** Issue kinds a recalculation can fix: a cached balance that drifted from its postings. */
const REPAIRABLE = new Set(['account_balance', 'person_balance']);

/**
 * Data health (§40). Runs the server's existing integrity check on demand and
 * explains the result. The only automatic fix offered is recomputing cached
 * balances from transactions — financial records themselves are never changed.
 */
export function DataHealthSection() {
  const t = useT();
  const toast = useToast();
  const currency = useCurrency();
  const queryClient = useQueryClient();
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [busy, setBusy] = useState<'check' | 'repair' | null>(null);

  async function check() {
    setBusy('check');
    try {
      setReport(await api.get<IntegrityReport>('/integrity'));
    } catch (err) {
      toast.error(t('dataHealth.failed'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function repair() {
    setBusy('repair');
    try {
      const result = await api.post<{ verification: IntegrityReport }>('/integrity/repair');
      setReport(result.verification);
      await queryClient.invalidateQueries();
      toast.success(t('dataHealth.repaired'));
    } catch (err) {
      toast.error(t('dataHealth.failed'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const money = (minor?: number) => (minor === undefined ? '—' : formatMoney(minor, { currency }));
  const canRepair = report?.issues.some((issue) => REPAIRABLE.has(issue.kind)) ?? false;

  return (
    <section className="border-t border-line-faint pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13.5px] font-medium text-ink">{t('dataHealth.title')}</p>
          <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">{t('dataHealth.description')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={busy === 'check'}
          disabled={busy !== null}
          leftIcon={<Stethoscope className="size-3.5" />}
          onClick={() => void check()}
        >
          {report ? t('dataHealth.recheck') : t('dataHealth.check')}
        </Button>
      </div>

      {report && (
        <div aria-live="polite" className="mt-4">
          {report.ok ? (
            <p className="flex items-start gap-2 rounded-lg border border-positive/25 bg-positive-soft p-4 text-[13px] text-ink-secondary">
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-positive" />
              {t('dataHealth.healthy', report.checked)}
            </p>
          ) : (
            <div className="rounded-lg border border-warning/25 bg-warning-soft p-4">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
                {t.plural('dataHealth.issues', report.issues.length)}
              </p>
              <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-ink-secondary">
                {report.issues.map((issue) => {
                  const key = `dataHealth.issue.${issue.kind}` as MessageKey;
                  const known = ['account_balance', 'person_balance', 'orphan_posting', 'unbalanced_transfer'].includes(issue.kind);
                  return (
                    <li key={`${issue.kind}:${issue.id}`}>
                      {t(known ? key : 'dataHealth.issue.other', {
                        name: issue.name,
                        expected: money(issue.expectedMinor),
                        actual: money(issue.actualMinor),
                        detail: issue.detail ?? issue.kind,
                      })}
                    </li>
                  );
                })}
              </ul>
              {canRepair ? (
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Button variant="secondary" size="sm" loading={busy === 'repair'} disabled={busy !== null} onClick={() => void repair()}>
                    {t('dataHealth.repair')}
                  </Button>
                  <p className="min-w-0 flex-1 basis-48 text-[11.5px] leading-relaxed text-ink-muted">{t('dataHealth.repairExplain')}</p>
                </div>
              ) : (
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">{t('dataHealth.manual')}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
