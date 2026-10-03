import { useState } from 'react';
import { Package, Plus } from 'lucide-react';
import type { ProductDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Money } from '../../components/ui/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useProducts } from '../../lib/queries4';
import { ProductFormSheet } from './ProductFormSheet';
import { ProductDetailSheet } from './ProductDetailSheet';
import { useT } from '../../i18n';

/** Basic inventory (§Phase 12) — products, stock levels and low-stock alerts. */
export function ProductsPage() {
  const t = useT();
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const { data: products = [], isLoading, isError, error, refetch } = useProducts({ lowStockOnly });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [viewing, setViewing] = useState<ProductDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.inventory')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('business.productsStockLevelsAndLowStock')}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('business.newProduct')}
        </Button>
      </header>

      <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <input
          type="checkbox"
          checked={lowStockOnly}
          onChange={(e) => setLowStockOnly(e.target.checked)}
          className="size-4 rounded-sm border-line text-gold focus:ring-gold"
        />
        {t('business.lowStockOnly')}
      </label>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={4} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Package className="size-5" />}
            title={lowStockOnly ? t('business.nothingIsLowOnStock') : t('business.noProductsYet')}
            description={lowStockOnly ? undefined : t('business.addAProductToStartTracking')}
            action={
              !lowStockOnly ? (
                <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  {t('business.addYourFirstProduct')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {products.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => setViewing(product)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-sunken sm:px-6"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-ink">{product.name}</span>
                      {product.isLowStock && <Badge tone="negative">{t('business.lowStock')}</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                      {product.sku} · {product.stockQty} {t('business.inStock2')}
                    </span>
                  </span>
                  <Money amountMinor={product.unitPriceMinor} size="md" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ProductFormSheet open={creating} product={null} onClose={() => setCreating(false)} />
      <ProductFormSheet
        open={Boolean(editing)}
        product={editing}
        onClose={() => {
          setEditing(null);
          setViewing(null);
        }}
      />
      <ProductDetailSheet
        open={Boolean(viewing) && !editing}
        product={viewing}
        onClose={() => setViewing(null)}
        onEdit={() => setEditing(viewing)}
      />
    </div>
  );
}
