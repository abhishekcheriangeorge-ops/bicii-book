import type { Metadata } from "next";

import { StatusScreen } from "@/components/shell/status-screen";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <StatusScreen
      code="404 · Not found"
      title="Nothing here"
      actions={<ButtonLink href="/">Go to Today</ButtonLink>}
    >
      <p>
        This page doesn&apos;t exist, or the record was removed. If you scanned a label, check it
        belongs to BICII.
      </p>
    </StatusScreen>
  );
}
