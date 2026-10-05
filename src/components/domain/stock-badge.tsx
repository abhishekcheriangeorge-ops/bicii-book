import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { stockLabel, stockTone } from "@/lib/inventory";

/**
 * A product's stock as a badge: tone and words from stockTone / stockLabel
 * (danger when none or below zero anywhere, D23; waiting at or below the
 * reorder point). A unique product counts its available units ("2
 * available"). `label` replaces the words (a part picker's "12 at Shop
 * floor · 20 total", a line's "37 left") with the same tone. Works in
 * server and client components (no state).
 */
export function StockBadge({
  onHand,
  reorderPoint = null,
  negativeLocations = 0,
  unique = false,
  availableUnits = 0,
  label,
  className,
}: {
  onHand: number;
  reorderPoint?: number | null;
  negativeLocations?: number;
  unique?: boolean;
  availableUnits?: number;
  label?: string;
  className?: string;
}) {
  if (unique) {
    return (
      <Badge tone={availableUnits > 0 ? "done" : "danger"} className={className}>
        {label ?? (availableUnits > 0 ? `${availableUnits} available` : "None available")}
      </Badge>
    );
  }
  return (
    <Badge
      tone={stockTone(onHand, reorderPoint, negativeLocations)}
      className={cn("tabular-nums", className)}
    >
      {label ?? stockLabel(onHand)}
    </Badge>
  );
}
