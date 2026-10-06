import { after } from "next/server";

import { authorizeStaff, getCorrelationId } from "@/lib/auth/session";
import { getPrintJob } from "@/lib/domain/labels";
import { child } from "@/lib/logger";
import { renderLabelPdf } from "@/lib/printing/adapters/pdf";
import { buildLabelDocument } from "@/lib/printing/document";
import { isPrintable } from "@/lib/printing/job";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

/**
 * GET /api/labels/{jobId}/pdf: the PDF of an OPEN print job (D59; SPEC
 * §15, §16), rendered from the job's snapshots only. Any printer's job may
 * be downloaded (a browser-print job too). It has no side effects: the
 * print view marks the job rendered when staff open it.
 *
 * Auth: proxy.ts sends signed-out page loads of non-public paths to /login
 * (an optimisation); this handler checks again with authorizeStaff, whose
 * redirect() and forbidden() become a 307 to /login and an empty 403 in a
 * Route Handler (next/dist/server/route-modules/app-route; the forbidden
 * and redirect API references list Route Handlers). RLS checks once more.
 *
 *   404  malformed or unknown job
 *   409  a finished job (printed or failed): history is never re-rendered
 *   200  application/pdf, inline, never cached
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/labels/[jobId]/pdf">) {
  const supabase = await createClient();
  const { staff } = await authorizeStaff(supabase);
  const { jobId } = await ctx.params;
  const notFound = () =>
    new Response("No such print job.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  if (!isUuid(jobId)) return notFound();
  const job = await getPrintJob(supabase, jobId);
  if (!job) return notFound();
  if (!isPrintable(job.status)) {
    return new Response(
      "This print job is finished. Print again from the record to make a new job.",
      {
        status: 409,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }

  const document = buildLabelDocument(job);
  const bytes = await renderLabelPdf(document);
  const correlationId = await getCorrelationId();
  after(() =>
    child(correlationId, { actor: staff.staffId }).info(
      { route: "labels.pdf", jobId: job.id, copies: document.copies },
      "label pdf",
    ),
  );
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="labels-${job.shortId}-x${document.copies}.pdf"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
