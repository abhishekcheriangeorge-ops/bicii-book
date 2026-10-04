import { describe, expect, it } from "vitest";

import {
  INTAKE_DRAFT_KEY,
  clearDraft,
  draftHasContent,
  parseDraft,
  readDraft,
  saveDraft,
  serializeDraft,
  type IntakeDraft,
} from "@/lib/intake-draft";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const draft: IntakeDraft = {
  v: 1,
  startedAt: "2026-10-04T02:42:00.000Z",
  workOrderId: ID(1),
  step: 3,
  customer: { id: ID(2), label: "Tan Wei Ming" },
  bike: { id: ID(3), shortId: "B-000001", title: "Specialized Tarmac" },
  requestedWork: "Full service",
  intakeNotes: "Scratch on top tube",
  leadId: ID(4),
  additionalIds: [ID(5)],
  services: [{ lineId: ID(6), serviceId: ID(7), quantity: "2" }],
};

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("intake draft (de)serialiser", () => {
  it("round-trips a draft", () => {
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("holds ids, labels and typed text only", () => {
    expect(Object.keys(JSON.parse(serializeDraft(draft))).sort()).toEqual(
      [
        "additionalIds",
        "bike",
        "customer",
        "intakeNotes",
        "leadId",
        "requestedWork",
        "services",
        "startedAt",
        "step",
        "v",
        "workOrderId",
      ].sort(),
    );
  });

  it("refuses anything malformed, from another version, or without a job id", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft("[]")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, v: 2 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, workOrderId: "nope" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, startedAt: "yesterday" }))).toBeNull();
  });

  it("drops the parts that do not make sense and keeps the rest", () => {
    const parsed = parseDraft(
      JSON.stringify({
        ...draft,
        step: 42,
        customer: { id: "x", label: "Someone" },
        bike: { id: ID(3) },
        leadId: 7,
        additionalIds: [ID(5), "bad"],
        services: [
          { lineId: ID(6), serviceId: ID(7), quantity: "2" },
          { lineId: ID(8), serviceId: ID(9), quantity: "-1" },
          { lineId: "x", serviceId: ID(9), quantity: "1" },
        ],
        requestedWork: 12,
      }),
    );
    expect(parsed).toEqual({
      ...draft,
      step: 0,
      customer: null,
      bike: null,
      leadId: null,
      additionalIds: [ID(5)],
      services: [{ lineId: ID(6), serviceId: ID(7), quantity: "2" }],
      requestedWork: "",
    });
  });

  it("knows an empty draft from one worth offering back", () => {
    const empty: IntakeDraft = {
      ...draft,
      customer: null,
      bike: null,
      requestedWork: " ",
      intakeNotes: "",
      services: [],
    };
    expect(draftHasContent(empty)).toBe(false);
    expect(draftHasContent({ ...empty, requestedWork: "Brakes" })).toBe(true);
    expect(draftHasContent(draft)).toBe(true);
  });
});

describe("intake draft storage", () => {
  it("saves one draft per device, reads it back, and clears it", () => {
    const storage = memory();
    saveDraft(draft, storage);
    expect([...storage.data.keys()]).toEqual([INTAKE_DRAFT_KEY]);
    expect(readDraft(storage)).toEqual(draft);
    clearDraft(storage);
    expect(readDraft(storage)).toBeNull();
  });

  it("removes the stored draft instead of saving an empty one", () => {
    const storage = memory();
    saveDraft(draft, storage);
    saveDraft(
      { ...draft, customer: null, bike: null, requestedWork: "", intakeNotes: "", services: [] },
      storage,
    );
    expect(storage.data.size).toBe(0);
  });

  it("never throws when storage is missing or blocked", () => {
    expect(readDraft(null)).toBeNull();
    expect(readDraft(throwing)).toBeNull();
    expect(() => saveDraft(draft, throwing)).not.toThrow();
    expect(() => clearDraft(throwing)).not.toThrow();
    expect(() => saveDraft(draft, null)).not.toThrow();
  });
});
