import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Timeline } from "@/components/domain/job-timeline";
import type { TimelineEntry } from "@/lib/domain/workshop";

const entry = (id: number): TimelineEntry => ({
  id,
  type: "note_added",
  at: "2026-10-04T02:00:00Z",
  actorName: "Nur",
  title: "Note added",
  detail: `Note ${id}`,
  tone: "neutral",
});

describe("Timeline", () => {
  it("says nothing about earlier events when it shows them all", () => {
    render(<Timeline entries={[entry(2), entry(1)]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says when older events, the check-in among them, were left out, and links to more", () => {
    render(
      <Timeline entries={[entry(3), entry(2)]} truncated moreHref="/jobs/x?events=all#timeline" />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "Showing the newest 2 events. Earlier ones, including the check-in, are not shown.",
    );
    expect(screen.getByRole("link", { name: "Show earlier events" })).toHaveAttribute(
      "href",
      "/jobs/x?events=all#timeline",
    );
  });

  it("still says so when there is no further page", () => {
    render(<Timeline entries={[entry(1)]} truncated moreHref={null} />);
    expect(screen.getByRole("note")).toHaveTextContent("Showing the newest 1 events.");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
