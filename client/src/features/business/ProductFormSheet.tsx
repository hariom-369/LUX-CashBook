import { useEffect, useState } from 'react';
import type { ProductDto } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useInvalidateInventory } from '../../lib/queries4';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

/** Create/edit a product (§Phase 12 — basic inventory). */
export function ProductFormSheet({ open, product, onClose }: { open: boolean; product: ProductDto | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidateInventory();
  const isEdit = Boolean(product);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unitPriceMinor, setUnitPriceMinor] = useState<number | null>(null);
  const [costPriceMinor, setCostPriceMinor] = useState<number | null>(null);
  const [hsnCode, setHsnCode] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(product?.name ?? '');
    setSku(product?.sku ?? '');
    setUnitPriceMinor(product?.unitPriceMinor ?? null);
    setCostPriceMinor(product?.costPriceMinor ?? null);
    setHsnCode(product?.hsnCode ?? '');
    setLowStockThreshold(product?.lowStockThreshold ?? 0);
    setNotes(product?.notes ?? '');
  }, [open, product]);

  async function save() {
    if (!name.trim() || !sku.trim() || unitPriceMinor === null) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), sku: sku.trim(), unitPriceMinor, costPriceMinor, hsnCode: hsnCode || undefined, lowStockThreshold, notes: notes || undefined };
      if (product) {
        await patchOrQueue(`/products/${product.id}`, { ...payload, rev: product.rev });
        toast.success(t('business.productUpdated'));
      } else {
        if (await createOrQueue('/products', payload)) toast.success(t('business.productAdded'));
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
      title={isEdit ? t('business.editProduct') : t('business.newProduct')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim() || !sku.trim() || unitPriceMinor === null} onClick={() => void save()}>
            {isEdit ? t('common.saveChanges') : t('business.addProduct')}
          </Button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <Field label={t('business.productName')} required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
        </Field>

        <Field label="SKU" required hint={t('business.aUniqueCodeForThisProduct')}>
          {({ id }) => <Input id={id} value={sku} maxLength={40} onChange={(e) => setSku(e.target.value.toUpperCase())} />}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('business.sellingPrice')} required>
            {({ id }) => <MoneyInput id={id} value={unitPriceMinor} onChange={setUnitPriceMinor} />}
          </Field>
          <Field label={t('business.costPrice')} hint={t('common.optional')}>
            {({ id }) => <MoneyInput id={id} value={costPriceMinor} onChange={setCostPriceMinor} />}
          </Field>
        </div>

        <Field label={t('business.hsnSacCode')} hint={t('business.optionalForGstReadyInvoices')}>
          {({ id }) => <Input id={id} value={hsnCode} maxLength={10} onChange={(e) => setHsnCode(e.target.value)} />}
        </Field>

        <Field label={t('business.lowStockAlertAt')} hint={t('business.flagThisProductOnceStockFalls')}>
          {({ id }) => (
            <Input id={id} type="number" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Number(e.target.value) || 0)} />
          )}
        </Field>

        <Field label={t('common.notes')}>
          {({ id }) => <Textarea id={id} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </form>
    </Sheet>
  );
}
