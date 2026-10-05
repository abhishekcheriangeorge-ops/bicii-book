import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { BoxIcon, PlusIcon, ScanIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill, type Status } from "@/components/ui/status-pill";
import { formatMoney } from "@/lib/money";
import { FormDemo, PickerDemo, SheetDemo, TabsDemo, ToastDemo } from "./demos";

export const metadata: Metadata = { title: "Primitives" };

const tones: Tone[] = ["neutral", "waiting", "progress", "done", "danger", "info"];
const statuses: Array<[Status, string]> = [
  ["waiting", "Waiting for parts"],
  ["progress", "In progress"],
  ["done", "Ready for collection"],
  ["danger", "Overdue"],
  ["info", "Booked"],
  ["neutral", "Collected"],
];

/**
 * Development-only gallery of the UI primitives, for reviewers' screenshots
 * and for checking tokens at phone and iPad widths. 404s in production.
 */
export default function PrimitivesGallery() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="gutter flex flex-col gap-10 pb-24">
      <PageHeader
        eyebrow="Design system"
        title="Primitives"
        description="Every shared control, in the BICII palette. Resize to a phone width to see sheets become bottom sheets."
        actions={
          <>
            <Button variant="outline" icon={<ScanIcon />}>
              Scan
            </Button>
            <Button icon={<PlusIcon />}>New intake</Button>
          </>
        }
      />

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Solid</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Void line</Button>
          <Button pending pendingLabel="Saving…">
            Save
          </Button>
          <Button disabled>Disabled</Button>
          <ButtonLink href="/" variant="outline">
            Link form
          </ButtonLink>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <IconButton aria-label="Scan a label" icon={<ScanIcon />} />
          <IconButton aria-label="Add" variant="outline" icon={<PlusIcon />} />
          <IconButton aria-label="Add part" variant="solid" icon={<PlusIcon />} />
        </div>
      </Section>

      <Section title="Status and badges">
        <div className="flex flex-wrap gap-2">
          {statuses.map(([status, label]) => (
            <StatusPill key={status} status={status}>
              {label}
            </StatusPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {statuses.map(([status, label]) => (
            <StatusPill key={status} status={status} emphasis="solid">
              {label}
            </StatusPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {tones.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          {tones.map((tone) => (
            <Badge key={`${tone}-solid`} tone={tone} emphasis="solid">
              {tone}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Forms">
        <FormDemo />
      </Section>

      <Section title="Search picker">
        <PickerDemo />
      </Section>

      <Section title="Sheet, toast, tabs">
        <div className="flex flex-wrap gap-3">
          <SheetDemo />
          <ToastDemo />
        </div>
        <TabsDemo />
      </Section>

      <Section title="Cards and dense tables">
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            eyebrow="J-000456"
            title="Cervélo R5 — full service"
            actions={<IconButton aria-label="Add line" icon={<PlusIcon />} />}
          >
            <table className="w-full text-dense">
              <thead>
                <tr className="text-left text-dust-500">
                  <th className="py-2 font-semibold">Line</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-hairline">
                  <td className="py-2">Full service</td>
                  <td className="py-2 text-right">1</td>
                  <td className="py-2 text-right">{formatMoney("180")}</td>
                </tr>
                <tr className="border-t border-hairline">
                  <td className="py-2">Chain, 12-speed</td>
                  <td className="py-2 text-right">1</td>
                  <td className="py-2 text-right">{formatMoney("89.9")}</td>
                </tr>
                <tr className="border-t-2 border-ink font-semibold">
                  <td className="py-2">Job total</td>
                  <td />
                  <td className="py-2 text-right">{formatMoney("269.9")}</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <Card title="Loading">
            <div className="flex flex-col gap-4" aria-busy="true">
              <Skeleton className="h-10 w-2/3" />
              <SkeletonText lines={3} />
              <Spinner label="Loading jobs" />
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Empty state">
        <EmptyState
          icon={<BoxIcon />}
          title="No parts on this job yet"
          description="Scan a part's label or search the catalog. Stock is shown beside every result."
          action={<Button icon={<PlusIcon />}>Add part</Button>}
        />
      </Section>

      <Section title="Surfaces">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-hairline bg-paper p-4">Paper (page)</div>
          <div className="rounded-2xl bg-sunken p-4">Sunken (dust-100)</div>
          <div className="rounded-2xl border border-hairline bg-card p-4">Card (white)</div>
          <div className="on-ink rounded-2xl bg-ink p-4 text-paper sm:col-span-3">
            Ink band — <span className="text-dust-300">dust-300 secondary text</span>
          </div>
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="eyebrow text-dust-500">{title}</h2>
      {children}
    </section>
  );
}
