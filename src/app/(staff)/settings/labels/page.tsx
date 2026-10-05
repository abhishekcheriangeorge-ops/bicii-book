import type { Metadata } from "next";

import { PrinterList, QrAddressForm, TemplateList } from "@/components/domain/label-settings";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { requireAdmin } from "@/lib/auth/session";
import { listProfiles, listTemplates } from "@/lib/domain/labels";
import { qrPayload } from "@/lib/ids";
import { environmentScanBase, getQrBase } from "@/lib/qr";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Labels and printers" };

/**
 * Labels and printers (admins only, a real 403 for anyone else: there is
 * no loading.tsx in this subtree, so the guard runs before anything
 * streams; SPEC §15, §16; PLAN D9, D56–D59; ADR-017).
 *
 * - "QR codes point to": the shop's public website address
 *   (shop_settings.public_site_url, getQrBase) with an example payload, or
 *   "Not set" (nothing prints until it is); "Change address" with a
 *   confirmation, and a note when the environment's scan base differs.
 * - Printers: browser print and PDF profiles, their calibration offsets,
 *   on/off and the default.
 * - Label templates per kind: size, QR, fields and text, with previews.
 */
export default async function LabelSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [base, profiles, templates] = await Promise.all([
    getQrBase(),
    listProfiles(supabase),
    listTemplates(supabase),
  ]);
  const envBase = environmentScanBase();

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Labels and printers"
        description="Where label QR codes point, which printers staff can choose, and the label sizes."
      />

      <Card title="QR codes point to">
        <div className="flex flex-col gap-4">
          {base ? (
            <div className="flex flex-col gap-1">
              <p data-qr-base="" className="font-mono text-lg font-semibold break-all select-all">
                {base}
              </p>
              <p className="text-sm text-dust-700">
                A label for P-000123 opens{" "}
                <span className="font-mono break-all">{qrPayload(base, "P-000123")}</span>
              </p>
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2">
              <StatusPill status="danger">Not set</StatusPill>
              <span className="text-sm text-dust-700">
                Labels cannot be printed until the public website address is set.
              </span>
            </p>
          )}
          {envBase && envBase !== base ? (
            <p className="rounded-xl bg-waiting-soft px-3 py-2 text-sm text-waiting-deep">
              This app&apos;s environment names another public address,{" "}
              <span className="font-mono break-all">{envBase}</span>. Scans of labels on that
              address are still accepted, but new labels use the address above.
            </p>
          ) : null}
          <QrAddressForm current={base} environmentBase={envBase} />
        </div>
      </Card>

      <Card title="Printers">
        <PrinterList profiles={profiles} />
      </Card>

      <Card title="Label templates">
        <TemplateList templates={templates} />
      </Card>
    </>
  );
}
