import { describe, expect, it } from "vitest";

import {
  BOARD_GROUPS,
  OVERDUE_AFTER_DAYS,
  STATUS_LABELS,
  WORK_ORDER_STATUSES,
  allowedTransitions,
  isClosedStatus,
  isOpenStatus,
  isOverdue,
  nextStatuses,
  primaryActions,
  statusTone,
  transitionRule,
  type WorkOrderStatus,
} from "@/lib/workshop";

describe("transitionRule (D15, D16; parity with the database in tests/db/work-orders.test.ts)", () => {
  it("lists the eleven statuses in enum order", () => {
    expect(WORK_ORDER_STATUSES).toEqual([
      "received",
      "diagnosing",
      "awaiting_customer",
      "awaiting_parts",
      "ready_to_start",
      "in_progress",
      "paused",
      "completed",
      "ready_for_collection",
      "collected",
      "cancelled",
    ]);
  });

  it("treats the same status as no move", () => {
    for (const s of WORK_ORDER_STATUSES) expect(transitionRule(s, s)).toBeNull();
  });

  it("never returns to received", () => {
    for (const s of WORK_ORDER_STATUSES) expect(transitionRule(s, "received")).toBeNull();
  });

  it("completes only from in progress or paused", () => {
    const from = WORK_ORDER_STATUSES.filter((s) => transitionRule(s, "completed") !== null);
    expect(from).toEqual(["in_progress", "paused"]);
  });

  it("collects only from completed or ready for collection (completed and collected differ)", () => {
    const from = WORK_ORDER_STATUSES.filter((s) => transitionRule(s, "collected") !== null);
    expect(from).toEqual(["completed", "ready_for_collection"]);
  });

  it("keeps collected and cancelled final", () => {
    expect(nextStatuses("collected")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
  });

  it("cancels from every open status, with a reason, and never after completion", () => {
    for (const s of WORK_ORDER_STATUSES) {
      if (s === "cancelled") continue;
      expect(transitionRule(s, "cancelled")).toBe(isOpenStatus(s) ? "reason_required" : null);
    }
  });

  it("reopens completed or ready-for-collection jobs to in progress with a reason", () => {
    expect(transitionRule("completed", "in_progress")).toBe("reason_required");
    expect(transitionRule("ready_for_collection", "in_progress")).toBe("reason_required");
    expect(transitionRule("ready_for_collection", "completed")).toBeNull();
    expect(transitionRule("collected", "in_progress")).toBeNull();
  });

  it("allows the documented moves between working statuses", () => {
    const table: Array<[WorkOrderStatus, WorkOrderStatus[]]> = [
      [
        "received",
        ["diagnosing", "awaiting_customer", "awaiting_parts", "ready_to_start", "in_progress"],
      ],
      ["in_progress", ["diagnosing", "awaiting_customer", "awaiting_parts", "paused", "completed"]],
      ["paused", ["diagnosing", "awaiting_customer", "awaiting_parts", "in_progress", "completed"]],
      ["completed", ["ready_for_collection", "collected"]],
    ];
    for (const [from, to] of table) {
      expect(WORK_ORDER_STATUSES.filter((s) => transitionRule(from, s) === "allowed")).toEqual(to);
    }
    expect(transitionRule("in_progress", "ready_to_start")).toBeNull();
    expect(transitionRule("received", "paused")).toBeNull();
  });
});

describe("open and closed statuses", () => {
  it("open = before completion; closed = collected or cancelled", () => {
    expect(WORK_ORDER_STATUSES.filter(isOpenStatus)).toEqual([
      "received",
      "diagnosing",
      "awaiting_customer",
      "awaiting_parts",
      "ready_to_start",
      "in_progress",
      "paused",
    ]);
    expect(WORK_ORDER_STATUSES.filter(isClosedStatus)).toEqual(["collected", "cancelled"]);
  });
});

describe("isOverdue (D20)", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it("is seven days", () => {
    expect(OVERDUE_AFTER_DAYS).toBe(7);
  });

  it("flags an open job checked in more than 7 x 24 hours ago", () => {
    expect(isOverdue({ status: "in_progress", checkedInAt: days(7.01) }, now)).toBe(true);
    expect(isOverdue({ status: "received", checkedInAt: new Date(days(30)) }, now)).toBe(true);
  });

  it("does not flag exactly 7 days or less", () => {
    expect(isOverdue({ status: "in_progress", checkedInAt: days(7) }, now)).toBe(false);
    expect(isOverdue({ status: "awaiting_parts", checkedInAt: days(1) }, now)).toBe(false);
  });

  it("never flags completed or closed jobs", () => {
    for (const status of ["completed", "ready_for_collection", "collected", "cancelled"] as const) {
      expect(isOverdue({ status, checkedInAt: days(60) }, now)).toBe(false);
    }
  });

  it("ignores an unreadable date", () => {
    expect(isOverdue({ status: "received", checkedInAt: "not a date" }, now)).toBe(false);
  });
});

describe("status labels, tones and board groups", () => {
  it("labels every status in staff words", () => {
    expect(STATUS_LABELS).toEqual({
      received: "Received",
      diagnosing: "Diagnosing",
      awaiting_customer: "Waiting on customer",
      awaiting_parts: "Waiting on parts",
      ready_to_start: "Ready to start",
      in_progress: "In progress",
      paused: "Paused",
      completed: "Completed",
      ready_for_collection: "Ready for collection",
      collected: "Collected",
      cancelled: "Cancelled",
    });
  });

  it("maps each status onto one of the five status tones or neutral", () => {
    const byTone = (tone: string) => WORK_ORDER_STATUSES.filter((s) => statusTone(s) === tone);
    expect(byTone("info")).toEqual(["received", "diagnosing", "ready_to_start"]);
    expect(byTone("waiting")).toEqual(["awaiting_customer", "awaiting_parts", "paused"]);
    expect(byTone("progress")).toEqual(["in_progress"]);
    expect(byTone("done")).toEqual(["completed", "ready_for_collection"]);
    expect(byTone("neutral")).toEqual(["collected"]);
    expect(byTone("danger")).toEqual(["cancelled"]);
  });

  it("puts every status in exactly one board group, in SPEC §7.2 order", () => {
    expect(BOARD_GROUPS.map((g) => g.id)).toEqual([
      "received",
      "waiting",
      "ready",
      "in_progress",
      "completed",
      "ready_for_collection",
      "closed",
    ]);
    const all = BOARD_GROUPS.flatMap((g) => g.statuses);
    expect([...all].sort()).toEqual([...WORK_ORDER_STATUSES].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(BOARD_GROUPS.find((g) => g.id === "received")?.statuses).toEqual([
      "received",
      "diagnosing",
    ]);
    expect(BOARD_GROUPS.find((g) => g.id === "waiting")?.statuses).toEqual([
      "awaiting_customer",
      "awaiting_parts",
      "paused",
    ]);
    expect(BOARD_GROUPS.find((g) => g.id === "closed")?.statuses).toEqual([
      "collected",
      "cancelled",
    ]);
  });
});

describe("allowedTransitions", () => {
  it("is exactly the moves transitionRule allows, with their reason rule", () => {
    for (const from of WORK_ORDER_STATUSES) {
      const moves = allowedTransitions(from);
      expect(moves.map((m) => m.to)).toEqual(nextStatuses(from));
      for (const m of moves) {
        expect(m.needsReason).toBe(transitionRule(from, m.to) === "reason_required");
      }
    }
  });

  it("calls cancelling a cancel and needs a reason for it", () => {
    const cancel = allowedTransitions("in_progress").find((m) => m.to === "cancelled");
    expect(cancel).toEqual({ to: "cancelled", needsReason: true, kind: "cancel" });
  });

  it("calls going back to in progress after completion a reopen, with a reason", () => {
    expect(allowedTransitions("completed")).toEqual([
      { to: "in_progress", needsReason: true, kind: "reopen" },
      { to: "ready_for_collection", needsReason: false, kind: "forward" },
      { to: "collected", needsReason: false, kind: "forward" },
    ]);
    expect(allowedTransitions("ready_for_collection")).toEqual([
      { to: "in_progress", needsReason: true, kind: "reopen" },
      { to: "collected", needsReason: false, kind: "forward" },
    ]);
  });

  it("offers nothing from a final status, and resuming from paused is a forward move", () => {
    expect(allowedTransitions("collected")).toEqual([]);
    expect(allowedTransitions("cancelled")).toEqual([]);
    expect(allowedTransitions("paused").find((m) => m.to === "in_progress")?.kind).toBe("forward");
  });
});

describe("primaryActions", () => {
  const labels = (s: Parameters<typeof primaryActions>[0]) =>
    primaryActions(s).map((a) => `${a.label} -> ${a.to}`);

  it("offers the usual next steps as one-tap buttons", () => {
    expect(labels("received")).toEqual(["Start work -> in_progress", "Diagnose -> diagnosing"]);
    expect(labels("diagnosing")).toEqual([
      "Start work -> in_progress",
      "Waiting on parts -> awaiting_parts",
    ]);
    for (const s of ["awaiting_customer", "awaiting_parts", "ready_to_start"] as const) {
      expect(labels(s)).toEqual(["Start work -> in_progress"]);
    }
    expect(labels("in_progress")).toEqual(["Complete -> completed", "Pause -> paused"]);
    expect(labels("paused")).toEqual(["Resume -> in_progress", "Complete -> completed"]);
    expect(labels("completed")).toEqual([
      "Ready for collection -> ready_for_collection",
      "Collected -> collected",
    ]);
    expect(labels("ready_for_collection")).toEqual(["Collected -> collected"]);
    expect(labels("collected")).toEqual([]);
    expect(labels("cancelled")).toEqual([]);
  });

  it("never offers a move that needs a reason or is not allowed", () => {
    for (const s of WORK_ORDER_STATUSES) {
      for (const a of primaryActions(s)) expect(transitionRule(s, a.to)).toBe("allowed");
    }
  });
});
