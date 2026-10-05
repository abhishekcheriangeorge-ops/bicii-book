import { ShortId } from "@/components/domain/short-id";
import { StockBadge } from "@/components/domain/stock-badge";
import { RowLink, RowList } from "@/components/ui/row-list";
import type { LowStockItem } from "@/lib/reports";

/**
 * The products most short of stock (server), from P4's reporting.low_stock
 * (largest shortfall first): each opens its product page.
 */
export function LowStockList({ items }: { items: readonly LowStockItem[] }) {
  if (items.length === 0) return <p className="text-sm text-dust-500">Nothing is low.</p>;
  return (
    <RowList label="Low stock">
      {items.map((p) => (
        <RowLink key={p.productId} href={`/products/${p.productId}`} className="min-h-14 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <ShortId value={p.shortId} />
              <StockBadge
                onHand={p.onHand}
                reorderPoint={p.reorderPoint}
                negativeLocations={p.negativeLocations}
              />
            </div>
            <p className="truncate text-sm font-medium">{p.name}</p>
          </div>
          {p.reorderPoint !== null ? (
            <span className="shrink-0 text-sm text-dust-500 tabular-nums">
              Reorder at {p.reorderPoint}
            </span>
          ) : null}
        </RowLink>
      ))}
    </RowList>
  );
}
