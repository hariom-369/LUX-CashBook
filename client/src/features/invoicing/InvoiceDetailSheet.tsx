import { useState } from 'react';
import { FileDown, Pencil, Send, Trash2, X } from 'lucide-react';
import { INVOICE_STATUS_META, formatDate, type InvoiceDto } from '@khata/shared';
import { Sheet, ConfirmDialog } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { ShareButton } from '../../components/ShareButton';
import { useToast } from '../../components/ui/Toast';
import { useAccounts } from '../../lib/queries';
import { useInvalidateInvoicing } from '../../lib/queries4';
import { useCurrency } from '../../hooks/useCurrency';
import { formatMoney } from '@khata/shared';
import { api, errorMessage } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { useT } from '../../i18n';

/** View an invoice and act on it (§Phase 11) — send, record payment, cancel, download. */
export function InvoiceDetailSheet({
  open,
  invoice,
  onClose,
  onEdit,
}: {
  open: boolean;
  invoice: InvoiceDto | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const currency = useCurrency();
  const invalidate = useInvalidateInvoicing();
  const { data: accounts = [] } = useAccounts();
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [payAccountId, setPayAccountId] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (!invoice) return null;
  const meta = INVOICE_STATUS_META[invoice.status];

  async function act(action: 'send' | 'pay' | 'cancel', body?: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.post(`/invoices/${invoice!.id}/${action}`, body);
      invalidate();
      toast.success(action === 'send' ? t('invoicing.invoiceSent') : action === 'pay' ? t('invoicing.paymentRecorded') : t('invoicing.invoiceCancelled'));
    } catch (err) {
      toast.error(t('invoicing.thatActionFailed'), errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmingCancel(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/invoices/${invoice!.id}`);
      invalidate();
      toast.success(t('invoicing.draftInvoiceDeleted'));
      onClose();
    } catch (err) {
      toast.error(t('invoicing.couldNotDeleteThisInvoice'), errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  async function exportPdf() {
    setPdfBusy(true);
    try {
      await downloadFile(`/pdf/invoices/${invoice!.id}`);
    } catch (err) {
      toast.error(t('common.couldNotGenerateThePdf'), errorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={invoice.number}
        description={invoice.personName}
        size="lg"
        busy={busy}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" leftIcon={<FileDown className="size-3.5" />} loading={pdfBusy} onClick={() => void exportPdf()}>
                PDF
              </Button>
              <ShareButton
                variant="ghost"
                size="sm"
                content={{
                  title: t('invoicing.invoiceNumber', { number: invoice.number }),
                  text: t('invoicing.shareText', { number: invoice.number, customer: invoice.personName ?? t('invoicing.customerFallback'), amount: formatMoney(invoice.totalMinor, { currency }), due: formatDate(invoice.dueDate) }),
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {invoice.status === 'draft' && (
                <>
                  <Button size="sm" variant="danger" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setConfirmingDelete(true)}>
                    {t('common.delete')}
                  </Button>
                  <Button size="sm" leftIcon={<Pencil className="size-3.5" />} onClick={onEdit}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="gold" leftIcon={<Send className="size-3.5" />} loading={busy} onClick={() => void act('send')}>
                    {t('invoicing.send')}
                  </Button>
                </>
              )}
              {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                <>
                  <Button size="sm" variant="secondary" leftIcon={<X className="size-3.5" />} onClick={() => setConfirmingCancel(true)}>
                    {t('common.cancel')}
                  </Button>
                  <Select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)} className="w-auto">
                    <option value="">{t('invoicing.depositTo')}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="gold" loading={busy} disabled={!payAccountId} onClick={() => void act('pay', { accountId: payAccountId })}>
                    {t('invoicing.markPaid')}
                  </Button>
                </>
              )}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <div className="text-right text-[12px] text-ink-muted">
              {t('invoicing.issued')} {formatDate(invoice.issueDate)} {t('invoicing.due')} {formatDate(invoice.dueDate)}
            </div>
          </div>

          <ul className="divide-y divide-line-faint rounded-md border border-line">
            {invoice.items.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {item.description} <span className="text-ink-faint">× {item.quantity}</span>
                </span>
                <Money amountMinor={item.amountMinor} size="sm" />
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-1 text-[13px]">
            <Row label={t('invoicing.subtotal')} amountMinor={invoice.subtotalMinor} />
            {invoice.discountMinor > 0 && <Row label={t('invoicing.discount')} amountMinor={-invoice.discountMinor} />}
            {invoice.gst && invoice.gst.igstMinor > 0 && <Row label={t('invoicing.igst', { taxPercent: invoice.taxPercent })} amountMinor={invoice.gst.igstMinor} />}
            {invoice.gst && invoice.gst.cgstMinor > 0 && <Row label={t('invoicing.cgstPercent', { percent: invoice.taxPercent / 2 })} amountMinor={invoice.gst.cgstMinor} />}
            {invoice.gst && invoice.gst.sgstMinor > 0 && <Row label={t('invoicing.sgstPercent', { percent: invoice.taxPercent / 2 })} amountMinor={invoice.gst.sgstMinor} />}
            {!invoice.gst && invoice.taxPercent > 0 && <Row label={t('invoicing.tax', { taxPercent: invoice.taxPercent })} amountMinor={invoice.taxMinor} />}
            <Row label={t('invoicing.total')} amountMinor={invoice.totalMinor} bold />
            {invoice.placeOfSupplyState && (
              <p className="mt-1 text-[11px] text-ink-faint">{t('invoicing.placeOfSupply')} {invoice.placeOfSupplyState}</p>
            )}
          </div>

          {invoice.notes && <p className="text-[12.5px] leading-relaxed text-ink-muted">{invoice.notes}</p>}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={remove}
        busy={busy}
        tone="danger"
        title={t('invoicing.deleteThisDraftInvoice')}
        confirmLabel={t('common.delete')}
      />
      <ConfirmDialog
        open={confirmingCancel}
        onCancel={() => setConfirmingCancel(false)}
        onConfirm={() => act('cancel')}
        busy={busy}
        tone="danger"
        title={t('invoicing.cancelThisInvoice')}
        description={t('invoicing.aCancelledInvoiceCanNeverBe')}
        confirmLabel={t('invoicing.cancelInvoice')}
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
