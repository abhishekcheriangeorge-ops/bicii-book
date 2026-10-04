import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * A section that exists in the navigation but is built in a later phase
 * (PLAN.md §2). Says which phase, so nobody mistakes it for a bug.
 */
export function ComingSoon({
  title,
  phase,
  description,
  icon,
}: {
  title: string;
  phase: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={icon} title={`Arrives in ${phase}`} description={description} />
    </>
  );
}
