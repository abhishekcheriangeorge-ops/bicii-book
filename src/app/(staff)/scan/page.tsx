import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";

import { CameraPermission } from "./camera-permission";

export const metadata: Metadata = { title: "Scan" };

/** QR scanning (SPEC §20). Phase 0: camera permission only; decoding arrives with inventory. */
export default async function ScanPage() {
  await requireStaff();
  return (
    <>
      <PageHeader
        title="Scan"
        description="Point the camera at a BICII QR label to open the bike, job, product or unit."
      />
      <CameraPermission />
    </>
  );
}
