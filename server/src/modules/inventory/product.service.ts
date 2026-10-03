import { Types, type HydratedDocument } from 'mongoose';
import type { ProductDto, StockMovementDto, StockMovementType } from '@khata/shared';
import { Product, StockMovement, type IProduct } from '../../models/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { claimRevision } from '../../lib/revision.js';

export type ProductDoc = HydratedDocument<IProduct>;

export function toProductDto(product: IProduct): ProductDto {
  return {
    id: String(product._id),
    rev: product.rev,
    workspaceId: String(product.workspaceId),
    name: product.name,
    sku: product.sku,
    unitPriceMinor: product.unitPriceMinor,
    costPriceMinor: product.costPriceMinor ?? undefined,
    hsnCode: product.hsnCode,
    stockQty: product.stockQty,
    lowStockThreshold: product.lowStockThreshold,
    isLowStock: product.stockQty <= product.lowStockThreshold,
    isActive: product.isActive,
    notes: product.notes,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function toStockMovementDto(movement: { _id: Types.ObjectId; productId: Types.ObjectId; type: StockMovementType; quantity: number; note?: string; date: Date; createdAt: Date }): StockMovementDto {
  return {
    id: String(movement._id),
    productId: String(movement.productId),
    type: movement.type,
    quantity: movement.quantity,
    note: movement.note,
    date: movement.date.toISOString(),
    createdAt: movement.createdAt.toISOString(),
  };
}

export interface CreateProductInput {
  name: string;
  sku: string;
  unitPriceMinor: number;
  costPriceMinor?: number | null;
  hsnCode?: string;
  lowStockThreshold?: number;
  notes?: string;
}

export async function listProducts(scope: RequestScope, options: { lowStockOnly?: boolean; includeInactive?: boolean } = {}): Promise<ProductDto[]> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId, deletedAt: null };
  if (!options.includeInactive) filter.isActive = true;

  const products = await Product.find(filter).sort({ name: 1 }).collation({ locale: 'en', strength: 2 }).lean();
  const dtos = products.map(toProductDto);
  return options.lowStockOnly ? dtos.filter((p) => p.isLowStock) : dtos;
}

export async function getProduct(scope: RequestScope, productId: string): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(productId)) throw notFound('Product');
  const product = await Product.findOne({ _id: productId, workspaceId: scope.workspaceId, deletedAt: null });
  if (!product) throw notFound('Product');
  return product;
}

async function assertSkuFree(scope: RequestScope, sku: string, excludeId?: Types.ObjectId): Promise<void> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId, sku: sku.toUpperCase(), deletedAt: null };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await Product.findOne(filter).lean();
  if (existing) throw conflict('A product with that SKU already exists.', 'PRODUCT_SKU_TAKEN');
}

export async function createProduct(scope: RequestScope, input: CreateProductInput, audit: AuditContext): Promise<ProductDoc> {
  await assertSkuFree(scope, input.sku);

  const product = await Product.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name: input.name.trim(),
    sku: input.sku.trim().toUpperCase(),
    unitPriceMinor: input.unitPriceMinor,
    costPriceMinor: input.costPriceMinor ?? null,
    hsnCode: input.hsnCode,
    lowStockThreshold: input.lowStockThreshold ?? 0,
    notes: input.notes,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Product',
    entityId: product._id,
    summary: `Added product "${product.name}" (${product.sku})`,
  });

  return product;
}

export type UpdateProductInput = Partial<CreateProductInput> & { isActive?: boolean };

export async function updateProduct(
  scope: RequestScope,
  productId: string,
  input: UpdateProductInput,
  audit: AuditContext,
  expectedRev?: number,
): Promise<ProductDoc> {
  const product = await getProduct(scope, productId);

  if (input.sku && input.sku.trim().toUpperCase() !== product.sku) {
    await assertSkuFree(scope, input.sku, product._id);
    product.sku = input.sku.trim().toUpperCase();
  }
  if (input.name !== undefined) product.name = input.name.trim();
  if (input.unitPriceMinor !== undefined) product.unitPriceMinor = input.unitPriceMinor;
  if (input.costPriceMinor !== undefined) product.costPriceMinor = input.costPriceMinor;
  if (input.hsnCode !== undefined) product.hsnCode = input.hsnCode;
  if (input.lowStockThreshold !== undefined) product.lowStockThreshold = input.lowStockThreshold;
  if (input.notes !== undefined) product.notes = input.notes;
  if (input.isActive !== undefined) product.isActive = input.isActive;

  await claimRevision(Product, product, expectedRev);
  await product.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Product',
    entityId: product._id,
    summary: `Updated product "${product.name}"`,
  });

  return product;
}

export async function deleteProduct(scope: RequestScope, productId: string, audit: AuditContext): Promise<void> {
  const product = await getProduct(scope, productId);

  product.deletedAt = new Date();
  product.deletedBy = scope.userId;
  await product.save();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Product',
    entityId: product._id,
    summary: `Removed product "${product.name}"`,
  });
}

/**
 * Record a stock change (§Phase 12). `in`/`out` take a positive quantity and
 * this derives the sign; `adjustment` takes the signed delta directly (a
 * stock-take correction can go either way). The product's `stockQty` is
 * updated with the same atomic `$inc` + conditional-match pattern used
 * everywhere else a cached figure must never drift — the update only
 * succeeds if the resulting stock would stay at or above zero, so a
 * concurrent "stock out" can't quietly oversell what's on the shelf.
 */
export async function recordStockMovement(
  scope: RequestScope,
  productId: string,
  input: { type: StockMovementType; quantity: number; note?: string; date?: Date },
  audit: AuditContext,
): Promise<{ product: ProductDto; movement: StockMovementDto }> {
  const product = await getProduct(scope, productId);

  if (input.quantity === 0 || !Number.isInteger(input.quantity)) {
    throw badRequest('Enter a non-zero whole number.');
  }
  if ((input.type === 'in' || input.type === 'out') && input.quantity < 0) {
    throw badRequest('Enter a positive quantity — the direction is set by the movement type.');
  }

  const delta = input.type === 'out' ? -Math.abs(input.quantity) : input.type === 'in' ? Math.abs(input.quantity) : input.quantity;

  const updated = await Product.findOneAndUpdate(
    { _id: product._id, workspaceId: scope.workspaceId, stockQty: { $gte: -delta } },
    { $inc: { stockQty: delta } },
    { new: true },
  );
  if (!updated) {
    throw conflict(`Not enough stock — only ${product.stockQty} of "${product.name}" available.`, 'INSUFFICIENT_STOCK');
  }

  const movement = await StockMovement.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    productId: product._id,
    type: input.type,
    quantity: delta,
    note: input.note,
    date: input.date ?? new Date(),
  });

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Product',
    entityId: product._id,
    summary: `${input.type === 'in' ? 'Added' : input.type === 'out' ? 'Removed' : 'Adjusted'} ${Math.abs(delta)} of "${product.name}" (now ${updated.stockQty})`,
  });

  return { product: toProductDto(updated), movement: toStockMovementDto(movement) };
}

export async function listStockMovements(scope: RequestScope, productId: string): Promise<StockMovementDto[]> {
  await getProduct(scope, productId);
  const movements = await StockMovement.find({ workspaceId: scope.workspaceId, productId }).sort({ date: -1, createdAt: -1 }).limit(200).lean();
  return movements.map(toStockMovementDto);
}
