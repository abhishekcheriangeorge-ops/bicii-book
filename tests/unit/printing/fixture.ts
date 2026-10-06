import { labelLayoutSchema } from "@/lib/printing/schemas";
import { SAMPLE_CONTENT } from "@/lib/printing/samples";
import type { LabelContent, PrintJob } from "@/lib/printing/types";

import { DEFAULT_LAYOUTS } from "../../fixtures/label-layouts";

/** A print job DTO for renderer tests (snapshots only, like getPrintJob's). */
export function sampleJob(
  overrides: Partial<PrintJob> & { content?: LabelContent } = {},
): PrintJob {
  const content = overrides.content ?? {
    ...SAMPLE_CONTENT.product,
    qrPayload: "http://localhost:4000/q/P-000011",
    shortId: "P-000011",
  };
  return {
    id: "a9000000-0000-4000-8000-000000000005",
    kind: content.kind,
    entityId: "9a000000-0000-4000-8000-000000000011",
    entityArchived: false,
    shortId: content.shortId,
    qrPayload: content.qrPayload,
    content,
    quantity: 10,
    adapter: "pdf",
    profile: { id: "a8000000-0000-4000-8000-000000000002", name: "PDF download", config: {} },
    template: {
      id: "1ab00000-0000-4000-8000-000000000001",
      name: "Product 58 × 40",
      widthMm: 58,
      heightMm: 40,
      layout: labelLayoutSchema.parse(DEFAULT_LAYOUTS[content.kind]),
    },
    status: "queued",
    error: null,
    requestedBy: { id: "s1", name: "Mechanic One" },
    statusChangedBy: null,
    createdAt: "2026-10-05T02:00:00Z",
    renderedAt: null,
    completedAt: null,
    reprintOfId: null,
    ...overrides,
  };
}
