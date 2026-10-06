import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LabelSheet, SCREEN_COPIES, browserAdapter } from "@/lib/printing/adapters/browser";
import { buildLabelDocument } from "@/lib/printing/document";

import { sampleJob } from "./fixture";

describe("LabelSheet (browser adapter)", () => {
  it("renders one [data-label] per copy, each carrying the job's payload", () => {
    const job = sampleJob({ quantity: 10 });
    const { container } = render(<LabelSheet document={buildLabelDocument(job)} />);
    const labels = [...container.querySelectorAll<HTMLElement>("[data-label]")];
    expect(labels).toHaveLength(10);
    for (const [i, label] of labels.entries()) {
      expect(label.dataset.qrPayload).toBe(job.qrPayload);
      expect(label.dataset.labelIndex).toBe(String(i));
      expect(label.style.width).toBe("58mm");
      expect(label.style.height).toBe("40mm");
      expect(label.style.breakAfter).toBe(i < 9 ? "page" : "auto");
      expect(label.querySelector("svg[role=img]")).not.toBeNull();
    }
    expect(container.textContent).toContain("1 of 10");
  });

  it("shows the first 20 on screen and says how many more will print", () => {
    const job = sampleJob({ quantity: 25 });
    const { container } = render(<LabelSheet document={buildLabelDocument(job)} />);
    expect(container.querySelectorAll("[data-label]")).toHaveLength(25);
    const hidden = [...container.querySelectorAll("figure")].filter((f) =>
      f.className.split(" ").includes("hidden"),
    );
    expect(hidden).toHaveLength(25 - SCREEN_COPIES);
    expect(container.textContent).toContain("+ 5 more identical labels");
  });

  it("is what the browser adapter renders", () => {
    expect(browserAdapter.delivery).toBe("print-dialog");
    const { container } = render(
      browserAdapter.render(buildLabelDocument(sampleJob({ quantity: 2 }))),
    );
    expect(container.querySelectorAll("[data-label]")).toHaveLength(2);
  });
});
