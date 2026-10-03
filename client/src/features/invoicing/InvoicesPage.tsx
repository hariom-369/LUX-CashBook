import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { INVOICE_STATUSES, INVOICE_STATUS_META, formatDate, type InvoiceDto, type InvoiceStatus } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Money } from '../../components/ui/Money';
import { Select } from '../../components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useInvoices } from '../../lib/queries4';
import { InvoiceFormSheet } from './InvoiceFormSheet';
import { InvoiceDetailSheet } from './InvoiceDetailSheet';
import { useT } from '../../i18n';

/** Invoices (§Phase 11) — issued to customers, paid through the ordinary transaction engine. */
export function InvoicesPage() {
  const t = useT();
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const { data: invoices = [], isLoading, isError, error, refetch } = useInvoices(status ? { status } : {});
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InvoiceDto | null>(null);
  const [viewing, setViewing] = useState<InvoiceDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.invoices')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('invoicing.issueSendAndTrackPaymentRevenue')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select aria-label={t('business.status')} value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')} className="w-auto">
            <option value="">{t('invoicing.allStatuses')}</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.label('invoiceStatus', s, INVOICE_STATUS_META[s].label)}
              </option>
            ))}
          </Select>
          <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('invoicing.newInvoice')}
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
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title={t('invoicing.noInvoicesYet')}
            description={t('invoicing.createYourFirstInvoiceItStarts')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('invoicing.createYourFirstInvoice')}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {invoices.map((invoice) => {
              const meta = INVOICE_STATUS_META[invoice.status];
              return (
                <li key={invoice.id}>
                  <button
                    type="button"
                    onClick={() => setViewing(invoice)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-sunken sm:px-6"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-ink">{invoice.number}</span>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                        {invoice.personName} {t('invoicing.due')} {formatDate(invoice.dueDate)}
                      </span>
                    </span>
                    <Money amountMinor={invoice.totalMinor} size="md" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <InvoiceFormSheet open={creating} invoice={null} onClose={() => setCreating(false)} />
      <InvoiceFormSheet
        open={Boolean(editing)}
        invoice={editing}
        onClose={() => {
          setEditing(null);
          setViewing(null);
        }}
      />
      <InvoiceDetailSheet
        open={Boolean(viewing) && !editing}
        invoice={viewing}
        onClose={() => setViewing(null)}
        onEdit={() => setEditing(viewing)}
      />
    </div>
  );
}
