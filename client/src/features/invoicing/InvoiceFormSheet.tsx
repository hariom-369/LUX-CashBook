import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { GST_RATES, PRICE_TYPES, toDateKey, type InvoiceDto, type PriceType } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { usePeople } from '../../lib/queries';
import { useProjects, useInvalidateInvoicing } from '../../lib/queries4';
import { useAuthStore } from '../../stores/auth.store';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

interface ItemRow {
  description: string;
  quantity: number;
  rateMinor: number | null;
  hsnCode: string;
}

const emptyRow = (): ItemRow => ({ description: '', quantity: 1, rateMinor: null, hsnCode: '' });

/** Mirrors `lib/invoiceMath.ts#splitGst` — a client-side preview only; the server recomputes and persists the real figure. */
function previewGstSplit(taxMinor: number, supplierState: string | undefined, customerState: string | undefined) {
  if (!supplierState || !customerState || supplierState !== customerState) {
    return { cgstMinor: 0, sgstMinor: 0, igstMinor: taxMinor };
  }
  const cgstMinor = Math.round(taxMinor / 2);
  return { cgstMinor, sgstMinor: taxMinor - cgstMinor, igstMinor: 0 };
}

/** Create/edit an invoice (§Phase 11). Only a draft can be edited — see `invoice.service.ts`. */
export function InvoiceFormSheet({ open, invoice, onClose }: { open: boolean; invoice: InvoiceDto | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidateInvoicing();
  const { data: customers = [] } = usePeople({ relationship: 'customer' });
  const { data: projects = [] } = useProjects({ status: 'active' });
  const supplierState = useAuthStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.state);
  const isEdit = Boolean(invoice);

  const [personId, setPersonId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [issueDate, setIssueDate] = useState(toDateKey(new Date()));
  const [dueDate, setDueDate] = useState(toDateKey(new Date(Date.now() + 14 * 86400000)));
  const [items, setItems] = useState<ItemRow[]>([emptyRow()]);
  const [discountMinor, setDiscountMinor] = useState<number | null>(null);
  const [taxPercent, setTaxPercent] = useState(0);
  const [priceType, setPriceType] = useState<PriceType>('exclusive');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (invoice) {
      setPersonId(invoice.personId);
      setProjectId(invoice.projectId ?? '');
      setIssueDate(invoice.issueDate.slice(0, 10));
      setDueDate(invoice.dueDate.slice(0, 10));
      setItems(invoice.items.map((i) => ({ description: i.description, quantity: i.quantity, rateMinor: i.rateMinor, hsnCode: i.hsnCode ?? '' })));
      setDiscountMinor(invoice.discountMinor || null);
      setTaxPercent(invoice.taxPercent);
      setPriceType(invoice.priceType);
      setNotes(invoice.notes ?? '');
    } else {
      setPersonId('');
      setProjectId('');
      setIssueDate(toDateKey(new Date()));
      setDueDate(toDateKey(new Date(Date.now() + 14 * 86400000)));
      setItems([emptyRow()]);
      setDiscountMinor(null);
      setTaxPercent(0);
      setPriceType('exclusive');
      setNotes('');
    }
  }, [open, invoice]);

  const lineTotalMinor = items.reduce((sum, item) => sum + Math.round(item.quantity * (item.rateMinor ?? 0)), 0);
  let subtotalMinor: number;
  let taxMinor: number;
  let totalMinor: number;
  if (priceType === 'inclusive') {
    const grossAfterDiscount = lineTotalMinor - (discountMinor ?? 0);
    subtotalMinor = Math.round(grossAfterDiscount / (1 + taxPercent / 100));
    taxMinor = grossAfterDiscount - subtotalMinor;
    totalMinor = grossAfterDiscount;
  } else {
    subtotalMinor = lineTotalMinor;
    const taxableMinor = Math.max(0, subtotalMinor - (discountMinor ?? 0));
    taxMinor = Math.round((taxableMinor * taxPercent) / 100);
    totalMinor = taxableMinor + taxMinor;
  }
  const customerState = customers.find((c) => c.id === personId)?.state;
  const gst = previewGstSplit(taxMinor, supplierState, customerState);

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  const canSubmit =
    Boolean(personId) &&
    items.length > 0 &&
    items.every((item) => item.description.trim() && item.quantity > 0 && item.rateMinor !== null && item.rateMinor >= 0);

  async function save() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        personId,
        projectId: projectId || null,
        issueDate: new Date(`${issueDate}T12:00:00`).toISOString(),
        dueDate: new Date(`${dueDate}T12:00:00`).toISOString(),
        items: items.map((item) => ({ description: item.description.trim(), quantity: item.quantity, rateMinor: item.rateMinor, hsnCode: item.hsnCode || undefined })),
        discountMinor: discountMinor ?? 0,
        taxPercent,
        priceType,
        notes: notes || undefined,
      };
      if (invoice) {
        await patchOrQueue(`/invoices/${invoice.id}`, { ...payload, rev: invoice.rev });
        toast.success(t('invoicing.invoiceUpdated'));
      } else {
        if (await createOrQueue('/invoices', payload)) toast.success(t('invoicing.invoiceCreatedAsADraft'));
      }
      invalidate();
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
      title={isEdit ? t('invoicing.editInvoice', { number: invoice!.number }) : t('invoicing.newInvoice')}
      size="xl"
      busy={busy}
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] text-ink-muted">
            {t('invoicing.total')} <Money amountMinor={totalMinor} size="sm" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="gold" loading={busy} disabled={!canSubmit} onClick={() => void save()}>
              {isEdit ? t('common.saveChanges') : t('invoicing.createDraft')}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('invoicing.customer')} required>
            {({ id }) => (
              <Select id={id} value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">{t('invoicing.chooseACustomer')}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('invoicing.project')} hint={t('invoicing.optionalAttributesThisRevenueToA')}>
            {({ id }) => (
              <Select id={id} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{t('invoicing.noProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('invoicing.issueDate')} required>
            {({ id }) => <Input id={id} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />}
          </Field>
          <Field label={t('reminders.form.due')} required>
            {({ id }) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink">{t('invoicing.lineItems')}</p>
            <Button type="button" size="sm" variant="secondary" leftIcon={<Plus className="size-3.5" />} onClick={() => setItems((c) => [...c, emptyRow()])}>
              {t('invoicing.addLine')}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_90px_70px_110px_110px_32px] items-center gap-2">
                <Input
                  aria-label={t('invoicing.lineField', { field: t('common.description'), n: index + 1 })}
                  placeholder={t('common.description')}
                  value={item.description}
                  maxLength={200}
                  onChange={(e) => updateItem(index, { description: e.target.value })}
                />
                <Input
                  aria-label={t('invoicing.lineField', { field: t('business.hsnSacCode'), n: index + 1 })}
                  placeholder="HSN/SAC"
                  value={item.hsnCode}
                  maxLength={10}
                  onChange={(e) => updateItem(index, { hsnCode: e.target.value })}
                />
                <Input
                  aria-label={t('invoicing.lineField', { field: t('business.quantity'), n: index + 1 })}
                  type="number"
                  min={0.01}
                  step="any"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, { quantity: Number(e.target.value) || 0 })}
                />
                <MoneyInput
                  aria-label={t('invoicing.lineField', { field: t('reports.rate'), n: index + 1 })}
                  value={item.rateMinor}
                  onChange={(v) => updateItem(index, { rateMinor: v })}
                />
                <div className="text-right text-[13px] text-ink-secondary">
                  <Money amountMinor={Math.round(item.quantity * (item.rateMinor ?? 0))} size="sm" />
                </div>
                <button
                  type="button"
                  aria-label={`${t('invoicing.removeLine')} ${index + 1}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((c) => c.filter((_, i) => i !== index))}
                  className="flex size-8 items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-sunken hover:text-negative disabled:opacity-30"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label={t('invoicing.discount')} hint={t('invoicing.aFlatAmountOffTheSubtotal')}>
            {({ id }) => <MoneyInput id={id} value={discountMinor} onChange={setDiscountMinor} />}
          </Field>
          <Field label={t('invoicing.gstRate')}>
            {({ id }) => (
              <Select id={id} value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value))}>
                {GST_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('invoicing.pricing')} hint={t('invoicing.doesTheRateAboveIncludeTax')}>
            {({ id }) => (
              <Select id={id} value={priceType} onChange={(e) => setPriceType(e.target.value as PriceType)}>
                {PRICE_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt === 'exclusive' ? t('invoicing.taxAddedOnTop') : t('invoicing.taxIncluded')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-1 rounded-md border border-line bg-sunken px-3.5 py-3 text-[13px]">
          <Row label={t('invoicing.subtotal')} amountMinor={subtotalMinor} />
          {Boolean(discountMinor) && <Row label={t('invoicing.discount')} amountMinor={-(discountMinor ?? 0)} />}
          {taxPercent > 0 && gst.igstMinor > 0 && <Row label={t('invoicing.igst', { taxPercent })} amountMinor={gst.igstMinor} />}
          {taxPercent > 0 && gst.cgstMinor > 0 && <Row label={t('invoicing.cgstPercent', { percent: taxPercent / 2 })} amountMinor={gst.cgstMinor} />}
          {taxPercent > 0 && gst.sgstMinor > 0 && <Row label={t('invoicing.sgstPercent', { percent: taxPercent / 2 })} amountMinor={gst.sgstMinor} />}
          <Row label={t('invoicing.total')} amountMinor={totalMinor} bold />
          {personId && !customerState && (
            <p className="mt-1 text-[11px] text-ink-faint">{t('invoicing.setThisCustomerSStateTo')}</p>
          )}
        </div>

        <Field label={t('common.notes')}>
          {({ id }) => <Textarea id={id} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </form>
    </Sheet>
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
