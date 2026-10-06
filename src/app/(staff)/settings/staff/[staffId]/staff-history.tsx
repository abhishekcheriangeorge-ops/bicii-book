import { formatDateTime } from "@/lib/dates";
import type { StaffEvent } from "@/lib/domain/staff";
import { describeStaffEvent } from "@/lib/staff-events";

/**
 * Who changed this person's role and access, when and why (staff_events,
 * newest first). Read-only: history is append-only in the database.
 */
export function StaffHistory({ events }: { events: StaffEvent[] }) {
  if (events.length === 0) return <p className="text-dust-700">No changes recorded yet.</p>;
  return (
    <ol aria-label="Staff history" className="flex flex-col divide-y divide-hairline">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
          <span className="font-medium">{describeStaffEvent(event)}</span>
          <span className="text-sm text-dust-500">
            <time dateTime={event.at}>{formatDateTime(event.at)}</time>
            {" · "}
            {event.actorName ?? "Set up outside the app"}
          </span>
          {event.reason ? <span className="text-sm text-dust-700">“{event.reason}”</span> : null}
        </li>
      ))}
    </ol>
  );
}
