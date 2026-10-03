import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { STOCK_MOVEMENT_TYPES, STOCK_MOVEMENT_LABELS, formatDate, type ProductDto, type StockMovementType } from '@khata/shared';
import { Sheet, ConfirmDialog } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input, Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useStockMovements, useInvalidateInventory } from '../../lib/queries4';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/** A product's stock history (§Phase 12) — add a movement, see the ledger that justifies the current count. */
export function ProductDetailSheet({
  open,
  product,
  onClose,
  onEdit,
}: {
  open: boolean;
  product: ProductDto | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const invalidate = useInvalidateInventory();
  const { data: movements = [] } = useStockMovements(product?.id);
  const [type, setType] = useState<StockMovementType>('in');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!product) return null;

  async function addMovement() {
    if (!quantity) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/products/${product!.id}/movements`, { type, quantity, note: note || undefined });
      invalidate();
      toast.success(tr('business.stockUpdated'));
      setQuantity('');
      setNote('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/products/${product!.id}`);
      invalidate();
      toast.success(tr('business.productRemoved'));
      onClose();
    } catch (err) {
      toast.error(tr('business.couldNotRemoveThisProduct'), errorMessage(err));
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
        title={product.name}
        description={product.sku}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button variant="danger" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setConfirmingDelete(true)}>
              {tr('common.remove')}
            </Button>
            <Button size="sm" leftIcon={<Pencil className="size-3.5" />} onClick={onEdit}>
              {tr('common.edit')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={tr('business.inStock')} value={<span className="text-[18px] font-semibold text-ink">{product.stockQty}</span>} />
            <Stat label={tr('business.sellingPrice')} value={<Money amountMinor={product.unitPriceMinor} size="md" />} />
            <Stat label={tr('business.status')} value={product.isLowStock ? <Badge tone="negative">{tr('business.lowStock')}</Badge> : <Badge tone="positive">OK</Badge>} />
          </div>

          <div className="rounded-md border border-line bg-sunken p-3.5">
            <p className="mb-2 text-[13px] font-medium text-ink">{tr('business.addAStockMovement')}</p>
            {error && <p className="mb-2 text-[12.5px] text-negative">{error}</p>}
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <Select value={type} onChange={(e) => setType(e.target.value as StockMovementType)}>
                {STOCK_MOVEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {tr.label('stockMovement', t, STOCK_MOVEMENT_LABELS[t])}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                placeholder={type === 'adjustment' ? '± quantity' : tr('business.quantity')}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <Input placeholder={tr('business.noteOptional')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" variant="gold" leftIcon={<Plus className="size-3.5" />} loading={busy} disabled={!quantity} onClick={() => void addMovement()}>
                {tr('common.add')}
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-[13px] font-medium text-ink">{tr('common.history')}</h3>
            {movements.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ink-muted">{tr('business.noMovementsRecordedYet')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line-faint rounded-md border border-line">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px]">
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink">{tr.label('stockMovement', m.type, STOCK_MOVEMENT_LABELS[m.type])}{m.note ? ` — ${m.note}` : ''}</span>
                      <span className="block text-[11px] text-ink-muted">{formatDate(m.date)}</span>
                    </span>
                    <span className={m.quantity >= 0 ? 'text-positive' : 'text-negative'}>
                      {m.quantity >= 0 ? '+' : ''}{m.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={remove}
        busy={busy}
        tone="danger"
        title={tr('business.removeThisProduct')}
        confirmLabel={tr('common.remove')}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3.5 py-3">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1">{value}</div>
    </div>
  );
}
