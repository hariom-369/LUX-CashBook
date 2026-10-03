import { badRequest } from './errors.js';
import type { PriceType } from '@khata/shared';

export interface LineItemInput {
  description: string;
  quantity: number;
  rateMinor: number;
  hsnCode?: string;
}

export interface ComputedLineItem extends LineItemInput {
  amountMinor: number;
}

export interface InvoiceTotals {
  items: ComputedLineItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxPercent: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Shared by invoices and quotations (§Phase 11, extended §Phase 13). A line
 * item's `amountMinor` is never trusted from the client: it's always
 * `quantity * rateMinor`, rounded here, so a client bug or a stale payload
 * can't make a saved document disagree with its own arithmetic.
 *
 * `priceType` changes how that same line amount is read, not how it's
 * computed: `exclusive` (the default, and everything Phase 11 ever did)
 * treats the line amount as the taxable value, with tax added on top.
 * `inclusive` treats it as already including tax, and backs the taxable
 * value out of it — the GST-standard "MRP already includes tax" case. Both
 * paths still return the same shape, with `subtotalMinor` always meaning
 * "the taxable value" and `totalMinor` always meaning "what the customer
 * actually pays."
 */
export function computeInvoiceTotals(
  items: LineItemInput[],
  discountMinor: number,
  taxPercent: number,
  priceType: PriceType = 'exclusive',
): InvoiceTotals {
  if (items.length === 0) throw badRequest('Add at least one line item.');

  const computed: ComputedLineItem[] = items.map((item) => ({
    ...item,
    amountMinor: Math.round(item.quantity * item.rateMinor),
  }));

  const lineTotalMinor = computed.reduce((sum, item) => sum + item.amountMinor, 0);
  if (discountMinor > lineTotalMinor) {
    throw badRequest('The discount cannot be more than the subtotal.');
  }

  if (priceType === 'inclusive') {
    const grossAfterDiscount = lineTotalMinor - discountMinor;
    const subtotalMinor = Math.round(grossAfterDiscount / (1 + taxPercent / 100));
    const taxMinor = grossAfterDiscount - subtotalMinor;
    return { items: computed, subtotalMinor, discountMinor, taxPercent, taxMinor, totalMinor: grossAfterDiscount };
  }

  const subtotalMinor = lineTotalMinor;
  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.round((taxableMinor * taxPercent) / 100);
  const totalMinor = taxableMinor + taxMinor;

  return { items: computed, subtotalMinor, discountMinor, taxPercent, taxMinor, totalMinor };
}

export interface GstBreakdown {
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
}

/**
 * CGST+SGST (intra-state) vs IGST (inter-state) — §Phase 13. GST's rule
 * compares the supplier's state (the workspace's own `state`) against the
 * place of supply (the customer's state at the time of the sale). Neither
 * state being on file is treated as "can't determine" — the whole tax
 * amount is left as IGST with a zero split rather than guessed, since
 * silently assuming intra-state would misstate a real filing figure.
 */
export function splitGst(taxMinor: number, supplierState: string | undefined, placeOfSupplyState: string | undefined): GstBreakdown {
  if (!supplierState || !placeOfSupplyState || supplierState !== placeOfSupplyState) {
    return { cgstMinor: 0, sgstMinor: 0, igstMinor: taxMinor };
  }
  const cgstMinor = Math.round(taxMinor / 2);
  return { cgstMinor, sgstMinor: taxMinor - cgstMinor, igstMinor: 0 };
}
