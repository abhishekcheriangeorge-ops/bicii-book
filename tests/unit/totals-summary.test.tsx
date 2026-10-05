import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TotalsSummary } from "@/components/domain/totals-summary";
import type { Totals } from "@/lib/domain/lines";
import type { WorkOrderYield } from "@/lib/reports";

const saleOnly: Totals = { currency: "SGD", lineCount: 2, saleTotal: "60.00" };

const withCosts: Totals = {
  ...saleOnly,
  costs: {
    costTotal: "35.00",
    yieldTotal: "25.00",
    ccShare: "12.00",
    yieldAfterCc: "13.00",
    costPendingCount: 0,
  },
};

const report = (patch: Partial<WorkOrderYield> = {}): WorkOrderYield => ({
  workOrderId: "d5000000-0000-4000-8000-000000000004",
  jobNumber: "J-000014",
  status: "collected",
  currency: "SGD",
  lineCount: 2,
  saleTotal: "60.00",
  costTotal: "35.00",
  yieldTotal: "25.00",
  cultCommons: "12.00",
  biciiAfterCc: "13.00",
  lossLineCount: 1,
  lossTotal: "-15.00",
  ccRates: ["0.3000"],
  recognizedAt: "2026-10-03T08:00:00Z",
  recognizedDay: "2026-10-03",
  costPendingCount: 0,
  ...patch,
});

const totals = () => screen.getByLabelText("Totals");

describe("TotalsSummary (the job yield panel)", () => {
  it("shows a mechanic without view_costs the sale total only", () => {
    render(<TotalsSummary totals={saleOnly} />);
    expect(totals()).toHaveTextContent("Total$60.00");
    expect(totals()).not.toHaveTextContent(/Cost|Yield|Cult Commons/);
    expect(screen.queryByText(/Counted in reports|sold at a loss/)).toBeNull();
  });

  it("without a report keeps Phase 3's summary and shared rate", () => {
    render(<TotalsSummary totals={withCosts} ccRate="0.3000" />);
    expect(totals()).toHaveTextContent("Cult Commons (30%)$12.00");
    expect(totals()).toHaveTextContent("BICII yield after Cult Commons$13.00");
    expect(screen.queryByText(/Counted in reports/)).toBeNull();
  });

  it("adds the loss note and the recognition day from the report", () => {
    render(<TotalsSummary totals={withCosts} ccRate="0.3000" report={report()} />);
    expect(totals()).toHaveTextContent("Cult Commons (30%)$12.00");
    expect(
      screen.getByText(
        "1 line sold at a loss: −$15.00. Losses don't reduce Cult Commons on other lines.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Counted in reports on Sat, 3 Oct 2026 (completed)"),
    ).toBeInTheDocument();
  });

  it("labels mixed snapshot rates as a range, over the page's shared rate", () => {
    render(
      <TotalsSummary
        totals={withCosts}
        ccRate={null}
        report={report({ ccRates: ["0.2500", "0.3000"], lossLineCount: 0, lossTotal: "0.00" })}
      />,
    );
    expect(totals()).toHaveTextContent("Cult Commons (25–30%)$12.00");
    expect(screen.queryByText(/sold at a loss/)).toBeNull();
  });

  it("says an open or reopened job counts once it is completed", () => {
    render(
      <TotalsSummary
        totals={withCosts}
        report={report({ status: "in_progress", recognizedAt: null, recognizedDay: null })}
      />,
    );
    expect(screen.getByText("Counted in reports once the job is completed")).toBeInTheDocument();
  });

  it("never shows report text to someone without costs, even if a report were passed", () => {
    render(<TotalsSummary totals={saleOnly} report={report()} />);
    expect(screen.queryByText(/Counted in reports|sold at a loss/)).toBeNull();
  });
});
