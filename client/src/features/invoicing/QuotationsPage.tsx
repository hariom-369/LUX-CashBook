import { useState } from 'react';
import { FileSignature, Plus } from 'lucide-react';
import { QUOTATION_STATUSES, QUOTATION_STATUS_META, formatDate, type QuotationDto, type QuotationStatus } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Money } from '../../components/ui/Money';
import { Select } from '../../components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useQuotations } from '../../lib/queries4';
import { QuotationFormSheet } from './QuotationFormSheet';
import { QuotationDetailSheet } from './QuotationDetailSheet';
import { useT } from '../../i18n';

/** Quotations (§Phase 11) — accept one and convert it into an invoice without retyping anything. */
export function QuotationsPage() {
  const t = useT();
  const [status, setStatus] = useState<QuotationStatus | ''>('');
  const { data: quotations = [], isLoading, isError, error, refetch } = useQuotations(status ? { status } : {});
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<QuotationDto | null>(null);
  const [viewing, setViewing] = useState<QuotationDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.quotations')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('invoicing.sendAnEstimateThenConvertIt')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select aria-label={t('business.status')} value={status} onChange={(e) => setStatus(e.target.value as QuotationStatus | '')} className="w-auto">
            <option value="">{t('invoicing.allStatuses')}</option>
            {QUOTATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.label('quotationStatus', s, QUOTATION_STATUS_META[s].label)}
              </option>
            ))}
          </Select>
          <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('invoicing.newQuotation')}
          </Button>
        </div>
      </header>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={4} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : quotations.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="size-5" />}
            title={t('invoicing.noQuotationsYet')}
            description={t('invoicing.createAnEstimateForACustomer')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('invoicing.createYourFirstQuotation')}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {quotations.map((quotation) => {
              const meta = QUOTATION_STATUS_META[quotation.status];
              return (
                <li key={quotation.id}>
                  <button
                    type="button"
                    onClick={() => setViewing(quotation)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-sunken sm:px-6"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-ink">{quotation.number}</span>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                        {quotation.personName} {t('invoicing.validUntil')} {formatDate(quotation.expiryDate)}
                      </span>
                    </span>
                    <Money amountMinor={quotation.totalMinor} size="md" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <QuotationFormSheet open={creating} quotation={null} onClose={() => setCreating(false)} />
      <QuotationFormSheet
        open={Boolean(editing)}
        quotation={editing}
        onClose={() => {
          setEditing(null);
          setViewing(null);
        }}
      />
      <QuotationDetailSheet
        open={Boolean(viewing) && !editing}
        quotation={viewing}
        onClose={() => setViewing(null)}
        onEdit={() => setEditing(viewing)}
      />
    </div>
  );
}
