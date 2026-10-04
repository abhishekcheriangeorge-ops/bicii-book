import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import type { TimelineEntry } from "@/lib/domain/workshop";
import type { StatusTone } from "@/lib/workshop";

const DOT: Record<StatusTone, string> = {
  info: "bg-indigo",
  waiting: "bg-yellow-deep",
  progress: "bg-sky-deep",
  done: "bg-green-deep",
  danger: "bg-red-deep",
  neutral: "bg-dust-500",
};

/**
 * A job's timeline (SPEC §7.3), newest first: what happened
 * (describeEvent), who did it ("Recorded outside the app" when nobody in
 * the app did) and when, with any note or reason quoted. It never shows a
 * cost: event payloads carry none.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="text-dust-500">Nothing has happened yet.</p>;
  return (
    <ol aria-label="Timeline" className="flex flex-col">
      {entries.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
          <span aria-hidden="true" className="flex flex-col items-center">
            <span className={cn("mt-1.5 size-3 shrink-0 rounded-full", DOT[e.tone])} />
            {i < entries.length - 1 ? <span className="mt-1 w-0.5 flex-1 bg-dust-200" /> : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium break-words">{e.title}</span>
            {e.detail ? (
              <span className="text-sm whitespace-pre-line text-dust-700">“{e.detail}”</span>
            ) : null}
            <span className="text-sm text-dust-500">
              {e.actorName ?? "Recorded outside the app"}
              {" · "}
              <time dateTime={e.at}>{formatDateTime(e.at)}</time>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
