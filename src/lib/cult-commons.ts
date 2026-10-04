/**
 * Cult Commons previews (SPEC §10; PLAN D1). DISPLAY ONLY: the authoritative
 * numbers are the generated columns of work_order_line_items and the
 * work_order_totals_staff view. This copies their arithmetic exactly, so a
 * preview shown before the database answers matches what it stores:
 *
 *   sale  = round(quantity × unit sale price, 2)
 *   cost  = round(quantity × unit direct cost, 2)
 *   yield = sale − cost
 *   Cult Commons = round(max(yield, 0) × rate, 2)        per line (D1)
 *   BICII yield after CC = yield − Cult Commons
 *
 * A job's figures are the sums of its lines': a loss-making line contributes
 * no Cult Commons and does not reduce another line's. Rounding is half up
 * (away from zero), as Postgres round(numeric). The fixture table in
 * tests/fixtures/cult-commons.ts is run through both this module and the
 * database.
 */
import { Decimal, toDecimal, type MoneyInput } from "@/lib/money";

export type LineInput = {
  quantity: MoneyInput;
  unitSalePrice: MoneyInput;
  unitDirectCost: MoneyInput;
  /** Fraction: 0.3 = 30%. */
  rate: MoneyInput;
};

export type Economics = {
  sale: Decimal;
  cost: Decimal;
  yield: Decimal;
  ccShare: Decimal;
  yieldAfterCc: Decimal;
};

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function lineEconomics(line: LineInput): Economics {
  const quantity = toDecimal(line.quantity);
  const sale = round2(quantity.times(toDecimal(line.unitSalePrice)));
  const cost = round2(quantity.times(toDecimal(line.unitDirectCost)));
  const lineYield = sale.minus(cost);
  const ccShare = round2(Decimal.max(lineYield, 0).times(toDecimal(line.rate)));
  return { sale, cost, yield: lineYield, ccShare, yieldAfterCc: lineYield.minus(ccShare) };
}

/** Sums of the lines' economics (D1: Cult Commons per line, never netted). */
export function jobEconomics(lines: readonly LineInput[]): Economics {
  const zero = new Decimal(0);
  return lines.map(lineEconomics).reduce<Economics>(
    (acc, l) => ({
      sale: acc.sale.plus(l.sale),
      cost: acc.cost.plus(l.cost),
      yield: acc.yield.plus(l.yield),
      ccShare: acc.ccShare.plus(l.ccShare),
      yieldAfterCc: acc.yieldAfterCc.plus(l.yieldAfterCc),
    }),
    { sale: zero, cost: zero, yield: zero, ccShare: zero, yieldAfterCc: zero },
  );
}
