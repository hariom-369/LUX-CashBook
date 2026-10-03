import { useState } from 'react';
import { ArrowRightLeft, Pencil, Send, Trash2 } from 'lucide-react';
import { QUOTATION_STATUS_META, formatDate, toDateKey, type QuotationDto } from '@khata/shared';
import { Sheet, ConfirmDialog } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Field, Input } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useInvalidateInvoicing } from '../../lib/queries4';
import { api, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/** View a quotation and act on it (§Phase 11) — mark its response, or convert it into an invoice. */
export function QuotationDetailSheet({
  open,
  quotation,
  onClose,
  onEdit,
}: {
  open: boolean;
  quotation: QuotationDto | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateInvoicing();
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertDueDate, setConvertDueDate] = useState(toDateKey(new Date(Date.now() + 14 * 86400000)));

  if (!quotation) return null;
  const meta = QUOTATION_STATUS_META[quotation.status];

  async function setStatus(status: 'sent' | 'accepted' | 'declined' | 'expired') {
    setBusy(true);
    try {
      await api.post(`/quotations/${quotation!.id}/status`, { status });
      invalidate();
    } catch (err) {
      toast.error(t('invoicing.couldNotUpdateStatus'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    setBusy(true);
    try {
      await api.post(`/quotations/${quotation!.id}/convert`, { dueDate: new Date(`${convertDueDate}T12:00:00`).toISOString() });
      invalidate();
      toast.success(t('invoicing.convertedToAnInvoice'));
      setConverting(false);
      onClose();
    } catch (err) {
      toast.error(t('invoicing.couldNotConvertThisQuotation'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/quotations/${quotation!.id}`);
      invalidate();
      toast.success(t('invoicing.draftQuotationDeleted'));
      onClose();
    } catch (err) {
      toast.error(t('invoicing.couldNotDeleteThisQuotation'), errorMessage(err));
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
        title={quotation.number}
        description={quotation.personName}
        size="lg"
        busy={busy}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            {quotation.status === 'draft' && (
              <div className="flex gap-2">
                <Button size="sm" variant="danger" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setConfirmingDelete(true)}>
                  {t('common.delete')}
                </Button>
                <Button size="sm" leftIcon={<Pencil className="size-3.5" />} onClick={onEdit}>
                  {t('common.edit')}
                </Button>
                <Button size="sm" variant="gold" leftIcon={<Send className="size-3.5" />} loading={busy} onClick={() => void setStatus('sent')}>
                  {t('invoicing.send')}
                </Button>
              </div>
            )}
            {quotation.status === 'sent' && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" loading={busy} onClick={() => void setStatus('declined')}>
                  {t('invoicing.declined')}
                </Button>
                <Button size="sm" variant="gold" loading={busy} onClick={() => void setStatus('accepted')}>
                  {t('invoicing.accepted')}
                </Button>
              </div>
            )}
            {(quotation.status === 'accepted' || quotation.status === 'sent' || quotation.status === 'draft') && (
              <Button size="sm" variant="gold" leftIcon={<ArrowRightLeft className="size-3.5" />} onClick={() => setConverting(true)}>
                {t('invoicing.convertToInvoice')}
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <div className="text-right text-[12px] text-ink-muted">
              {t('invoicing.issued')} {formatDate(quotation.issueDate)} {t('invoicing.validUntil')} {formatDate(quotation.expiryDate)}
            </div>
          </div>

          <ul className="divide-y divide-line-faint rounded-md border border-line">
            {quotation.items.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {item.description} <span className="text-ink-faint">× {item.quantity}</span>
                </span>
                <Money amountMinor={item.amountMinor} size="sm" />
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-1 text-[13px]">
            <Row label={t('invoicing.subtotal')} amountMinor={quotation.subtotalMinor} />
            {quotation.discountMinor > 0 && <Row label={t('invoicing.discount')} amountMinor={-quotation.discountMinor} />}
            {quotation.gst && quotation.gst.igstMinor > 0 && <Row label={t('invoicing.igst', { taxPercent: quotation.taxPercent })} amountMinor={quotation.gst.igstMinor} />}
            {quotation.gst && quotation.gst.cgstMinor > 0 && <Row label={t('invoicing.cgstPercent', { percent: quotation.taxPercent / 2 })} amountMinor={quotation.gst.cgstMinor} />}
            {quotation.gst && quotation.gst.sgstMinor > 0 && <Row label={t('invoicing.sgstPercent', { percent: quotation.taxPercent / 2 })} amountMinor={quotation.gst.sgstMinor} />}
            {!quotation.gst && quotation.taxPercent > 0 && <Row label={t('invoicing.tax', { taxPercent: quotation.taxPercent })} amountMinor={quotation.taxMinor} />}
            <Row label={t('invoicing.total')} amountMinor={quotation.totalMinor} bold />
          </div>

          {quotation.notes && <p className="text-[12.5px] leading-relaxed text-ink-muted">{quotation.notes}</p>}
        </div>
      </Sheet>

      <Sheet
        open={converting}
        onClose={() => setConverting(false)}
        title={t('invoicing.convertToInvoice')}
        size="sm"
        busy={busy}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConverting(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="gold" loading={busy} onClick={() => void convert()}>
              {t('invoicing.convert')}
            </Button>
          </div>
        }
      >
        <Field label={t('invoicing.invoiceDueDate')} required>
          {({ id }) => <Input id={id} type="date" value={convertDueDate} onChange={(e) => setConvertDueDate(e.target.value)} />}
        </Field>
      </Sheet>

      <ConfirmDialog
        open={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={remove}
        busy={busy}
        tone="danger"
        title={t('invoicing.deleteThisDraftQuotation')}
        confirmLabel={t('common.delete')}
      />
    </>
  );
}

function Row({ label, amountMinor, bold }: { label: string; amountMinor: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
      <span>{label}</span>
      <Money amountMinor={amountMinor} size="sm" />
    </div>
  );
}
