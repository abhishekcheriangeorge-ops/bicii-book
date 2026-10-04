import { describe, expect, it } from "vitest";

import { jobEconomics, lineEconomics } from "@/lib/cult-commons";

import { JOB_FIXTURES, LINE_FIXTURES } from "../fixtures/cult-commons";

describe("Cult Commons is 30% of positive yield after direct costs (SPEC §10)", () => {
  it.each(LINE_FIXTURES)("$name", (f) => {
    const e = lineEconomics({
      quantity: f.quantity,
      unitSalePrice: f.unitSalePrice,
      unitDirectCost: f.unitDirectCost,
      rate: f.rate,
    });
    expect({
      sale: e.sale.toFixed(2),
      cost: e.cost.toFixed(2),
      yield: e.yield.toFixed(2),
      cc: e.ccShare.toFixed(2),
      afterCc: e.yieldAfterCc.toFixed(2),
    }).toEqual({ sale: f.sale, cost: f.cost, yield: f.yield, cc: f.cc, afterCc: f.afterCc });
  });
});

describe("a job's Cult Commons is the sum of its lines' shares (D1)", () => {
  it.each(JOB_FIXTURES)("$name", (job) => {
    const e = jobEconomics(job.lines.map((i) => LINE_FIXTURES[i]));
    expect({
      sale: e.sale.toFixed(2),
      cost: e.cost.toFixed(2),
      yield: e.yield.toFixed(2),
      cc: e.ccShare.toFixed(2),
      afterCc: e.yieldAfterCc.toFixed(2),
    }).toEqual({
      sale: job.sale,
      cost: job.cost,
      yield: job.yield,
      cc: job.cc,
      afterCc: job.afterCc,
    });
  });

  it("an empty job is all zeros", () => {
    const e = jobEconomics([]);
    expect([e.sale, e.cost, e.yield, e.ccShare, e.yieldAfterCc].map((d) => d.toFixed(2))).toEqual(
      Array(5).fill("0.00"),
    );
  });
});
