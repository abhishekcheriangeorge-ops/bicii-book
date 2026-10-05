"use client";

import { useId } from "react";

import { ChipRadioGroup } from "@/components/ui/chip";

/**
 * The lead mechanic as single-select chips (D22: active staff only): the
 * signed-in staff member first as "Me", then everyone else, then
 * Unassigned. Shared by intake's People step and appointment check-in.
 */
export function LeadPicker({
  me,
  staff,
  value,
  onChange,
  label = "Lead mechanic",
  labelId,
}: {
  me: { id: string; name: string };
  staff: readonly { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  /** The heading's id (generated when omitted). */
  labelId?: string;
}) {
  const auto = useId();
  const id = labelId ?? `${auto}-lead`;
  const ordered = [...staff.filter((s) => s.id === me.id), ...staff.filter((s) => s.id !== me.id)];
  return (
    <div className="flex flex-col gap-2">
      <h3 id={id} className="font-display text-xs font-bold tracking-wide uppercase">
        {label}
      </h3>
      <ChipRadioGroup<string | null>
        labelledBy={id}
        value={value}
        onChange={onChange}
        options={[
          ...ordered.map((s) => ({
            value: s.id,
            children: s.id === me.id ? "Me" : s.name,
            label: s.id === me.id ? `Me (${s.name})` : s.name,
          })),
          { value: null, children: "Unassigned" },
        ]}
      />
    </div>
  );
}
