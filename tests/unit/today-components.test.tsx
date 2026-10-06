import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdjustmentList } from "@/components/domain/today/adjustment-list";
import { ExceptionList } from "@/components/domain/today/exception-list";
import { MoneyTile, StatTile, moneySizeClass } from "@/components/domain/today/stat-tile";
import {
  ADJUSTMENT_ROWS,
  NOT_TRACKED,
  splitAdjustments,
  type AdjustmentRow,
  type OperationalException,
} from "@/lib/reports";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StatTile and MoneyTile", () => {
  it("reads a placeholder measure as NOT_TRACKED, the one source of that wording", () => {
    render(<StatTile label="Appointments" value="" notTracked hint="Arrives with appointments" />);
    expect(screen.getByText(NOT_TRACKED)).toHaveClass("sr-only");
    expect(NOT_TRACKED).toBe("Not tracked yet");
  });

  it("keeps the amount on one line and lets the currency code wrap under it", () => {
    render(<MoneyTile label="Yield" amount="1234.56" currency="SGD" />);
    const amount = screen.getByText("$1,234.56");
    expect(amount).toHaveClass("whitespace-nowrap");
    expect(amount.parentElement).toHaveClass("flex-wrap");
    expect(screen.getByText("SGD").parentElement).toBe(amount.parentElement);
  });

  it("sizes longer amounts smaller, relative to the tile, never below 1rem", () => {
    const pct = (c: string) => Number(/,([\d.]+)cqi,/.exec(c)?.[1]);
    expect(pct(moneySizeClass("$400.00".length))).toBeGreaterThan(
      pct(moneySizeClass("$1,234.56".length)),
    );
    expect(pct(moneySizeClass("$1,234.56".length))).toBeGreaterThan(
      pct(moneySizeClass("−$12,345.67".length)),
    );
    for (const n of [4, 7, 9, 11, 14]) {
      expect(moneySizeClass(n)).toMatch(/^text-\[clamp\(1rem,[\d.]+cqi,2\.25rem\)\]$/);
      expect(moneySizeClass(n, true)).toMatch(/^text-\[clamp\(1rem,[\d.]+cqi,3rem\)\]$/);
    }
  });
});

const negative = (location: string): OperationalException => ({
  kind: "negative_stock",
  severity: "danger",
  entityType: "product",
  entityId: "c2000000-0000-4000-8000-000000000001",
  entityLabel: "P-000001",
  subjectLabel: `Road inner tube · ${location}`,
  days: null,
  quantity: -2,
  since: "2026-10-04T02:00:00Z",
});

describe("ExceptionList", () => {
  it("shows a Shopify failure with its order, the human message and a link to the queue (D86)", () => {
    render(
      <ExceptionList
        rows={[
          {
            kind: "integration_failed",
            severity: "danger",
            entityType: "integration_job",
            entityId: "e3000000-0000-4000-8000-000000000001",
            entityLabel: "#1002",
            subjectLabel:
              'Order #1002: "BICII cotton cap" (Shopify variant 9199999999) is not linked to a BICII product.',
            days: 1,
            quantity: null,
            since: "2026-10-05T11:45:00Z",
          },
        ]}
      />,
    );
    const row = screen.getByRole("link");
    expect(row).toHaveAttribute("href", "/shopify/queue?job=e3000000-0000-4000-8000-000000000001");
    expect(row).toHaveTextContent("Shopify needs attention");
    expect(row).toHaveTextContent("#1002");
    expect(row).toHaveTextContent("is not linked to a BICII product");
    expect(row).toHaveTextContent("Fix it in the Shopify queue");
  });

  it("lists a product below zero at two locations as two rows, without a duplicate key", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ExceptionList rows={[negative("Shop floor"), negative("Workshop store")]} />);
    const list = screen.getByRole("list", { name: "Needs attention" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list).toHaveTextContent("Below zero at Shop floor: −2");
    expect(list).toHaveTextContent("Below zero at Workshop store: −2");
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });

  it("says how many it shows when the list is capped below the total", () => {
    render(<ExceptionList rows={[negative("Shop floor")]} total={45} />);
    expect(screen.getByText("Showing the 1 most urgent of 45")).toBeInTheDocument();
  });

  it("says nothing extra when every exception is listed", () => {
    render(<ExceptionList rows={[negative("Shop floor")]} total={1} />);
    expect(screen.queryByText(/most urgent/)).toBeNull();
  });
});

const adjustment = (i: number, significant = false): AdjustmentRow => ({
  movementId: i,
  createdAt: `2026-10-05T0${i % 10}:00:00Z`,
  movementType: "stock_adjustment",
  productId: `c2000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
  productShortId: `P-0000${String(i).padStart(2, "0")}`,
  productName: `Product ${i}`,
  unitId: null,
  unitShortId: null,
  locationName: "Shop floor",
  quantityDelta: significant ? -6 : 1,
  reason: "Opening count",
  actorName: "Admin",
  significant,
  valueAtCost: null,
  currency: "SGD",
});

describe("AdjustmentList", () => {
  it("puts significant adjustments first and keeps the newest-first order within each group", () => {
    const rows = [adjustment(1), adjustment(2, true), adjustment(3), adjustment(4, true)];
    expect(splitAdjustments(rows, 3)).toEqual({
      shown: [rows[1], rows[3], rows[0]],
      more: [rows[2]],
    });
  });

  it("lists the first few and puts the rest behind 'Show N more'", () => {
    const rows = Array.from({ length: 15 }, (_, i) => adjustment(i + 1, i === 12));
    render(<AdjustmentList rows={rows} />);
    const shown = screen.getByRole("list", { name: "Stock adjustments" });
    expect(within(shown).getAllByRole("listitem")).toHaveLength(ADJUSTMENT_ROWS);
    expect(within(shown).getAllByRole("listitem")[0]).toHaveTextContent("Significant");
    expect(screen.getByText(`Show ${15 - ADJUSTMENT_ROWS} more`)).toBeInTheDocument();
    const more = screen.getByRole("list", { name: "More stock adjustments", hidden: true });
    expect(more.querySelectorAll("li")).toHaveLength(15 - ADJUSTMENT_ROWS);
  });

  it("has no disclosure when every adjustment fits", () => {
    render(<AdjustmentList rows={[adjustment(1), adjustment(2)]} />);
    expect(screen.queryByText(/Show \d+ more/)).toBeNull();
  });
});
