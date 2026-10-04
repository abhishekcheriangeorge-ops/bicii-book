import { describe, expect, it } from "vitest";

import {
  OVERDUE_AFTER_DAYS,
  WORK_ORDER_STATUSES,
  isClosedStatus,
  isOpenStatus,
  isOverdue,
  nextStatuses,
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
