import { PERMISSION_LABELS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/dates";
import type { StaffEvent } from "@/lib/domain/staff";

function describe(event: StaffEvent): string {
  const permission = event.permission ? PERMISSION_LABELS[event.permission].label : "";
  switch (event.type) {
    case "created":
      return "Added as staff";
    case "permission_granted":
      return `${permission} granted`;
    case "permission_revoked":
      return `${permission} removed`;
    case "deactivated":
      return "Deactivated";
    case "reactivated":
      return "Reactivated";
    case "role_changed": {
      const to = (event.payload.role as { to?: string } | undefined)?.to;
      return to === "admin" ? "Made an admin" : "Changed to staff";
    }
    case "details_changed":
      return "Details changed";
  }
}

/**
 * Who changed this person's access, when and why (staff_events, newest
 * first). Read-only: history is append-only in the database.
 */
export function StaffHistory({ events }: { events: StaffEvent[] }) {
  if (events.length === 0) return <p className="text-dust-700">No changes recorded yet.</p>;
  return (
    <ol aria-label="Staff history" className="flex flex-col divide-y divide-hairline">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
          <span className="font-medium">{describe(event)}</span>
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
