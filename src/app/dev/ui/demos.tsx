"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Card } from "@/components/ui/card";
import { SearchPicker, type PickerOption } from "@/components/ui/search-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatMoney, parseMoney } from "@/lib/money";

const catalog: PickerOption[] = [
  {
    id: "p1",
    label: "Chain, Shimano 12-speed",
    description: "P-000101 · CN-M8100",
    meta: "4 in stock",
  },
  { id: "p2", label: "Brake pads, resin", description: "P-000102 · BP-L03A", meta: "12 in stock" },
  {
    id: "p3",
    label: "Tubeless sealant 500ml",
    description: "P-000103",
    meta: "0 in stock",
    disabled: true,
  },
  { id: "p4", label: "Cassette 11-34", description: "P-000104 · CS-M8100", meta: "2 in stock" },
  { id: "p5", label: "Bar tape, black", description: "P-000105", meta: "9 in stock" },
  { id: "p6", label: "Inner tube 700x28", description: "P-000106", meta: "31 in stock" },
];

async function fakeSearch(query: string): Promise<PickerOption[]> {
  await new Promise((r) => setTimeout(r, 250));
  const q = query.toLowerCase();
  return catalog.filter((p) => `${p.label} ${p.description}`.toLowerCase().includes(q));
}

export function FormDemo() {
  const [price, setPrice] = useState("1250");
  const parsed = parseMoney(price);
  return (
    <div className="grid max-w-3xl gap-5 md:grid-cols-2">
      <Field label="Customer name" required hint="As it should appear on the job card">
        <Input placeholder="Jane Tan" autoComplete="off" />
      </Field>
      <Field label="Phone" error="Enter a Singapore number, e.g. 9123 4567">
        <Input type="tel" defaultValue="12" />
      </Field>
      <Field
        label="Sale price"
        hint={parsed ? `Will be saved as ${formatMoney(parsed)}` : "Up to two decimals"}
        error={parsed ? undefined : "Not an amount"}
      >
        <NumberInput kind="money" value={price} onValueChange={setPrice} />
      </Field>
      <Field label="Quantity" hint="Whole units">
        <NumberInput kind="quantity" stepper defaultValue="1" minValue={1} />
      </Field>
      <Field label="Condition notes" className="md:col-span-2">
        <Textarea placeholder="Scratches on top tube, rear derailleur hanger bent" />
      </Field>
      <div className="flex flex-col">
        <Checkbox label="Customer approved the quote" description="Recorded on the job timeline" />
        <Checkbox label="Disabled option" disabled />
      </div>
      <div className="flex flex-col">
        <Switch label="Show costs" description="Requires the view_costs permission" />
        <SegmentedControl
          label="Board filter"
          options={[
            { value: "all", label: "All", count: 9 },
            { value: "mine", label: "Mine", count: 3 },
            { value: "waiting", label: "Waiting", count: 2 },
          ]}
        />
      </div>
    </div>
  );
}

export function PickerDemo() {
  const [picked, setPicked] = useState<PickerOption | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <Field label="Add a part" hint="Type a name, SKU or short ID">
        <SearchPicker
          search={fakeSearch}
          value={picked}
          onSelect={setPicked}
          placeholder="Search parts…"
          action={{
            label: (q) => (q ? `Create “${q}”` : "Create a new product"),
            onSelect: (q) => setCreated(q || "(new product)"),
          }}
        />
      </Field>
      <p className="text-sm text-dust-500">
        Selected: {picked ? picked.label : "nothing"}
        {created ? ` · would create “${created}”` : ""}
      </p>
      {/* Pickers usually live in a Card (forms); its results must not be cut off at the Card's edge. */}
      <Card title="Inside a Card">
        <Field label="Customer">
          <SearchPicker search={fakeSearch} placeholder="Search customers…" />
        </Field>
      </Card>
    </div>
  );
}

export function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open sheet
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Adjust stock"
        description="A reason is required and is recorded with your name."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save adjustment</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Change" required>
            <NumberInput kind="quantity" stepper defaultValue="0" />
          </Field>
          <Field label="Reason" required>
            <Textarea placeholder="Counted during stock take" />
          </Field>
        </div>
      </Sheet>
    </>
  );
}

export function ToastDemo() {
  const { toast } = useToast();
  return (
    <>
      <Button
        variant="outline"
        onClick={() => toast({ title: "Part added", description: "Stock 4 → 3", tone: "success" })}
      >
        Success toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast({ title: "Not saved", description: "This unit is already sold.", tone: "error" })
        }
      >
        Error toast
      </Button>
    </>
  );
}

export function TabsDemo() {
  return (
    <Tabs
      label="Job sections"
      items={[
        {
          id: "lines",
          label: "Lines",
          content: <p className="text-dust-700">Services and parts.</p>,
        },
        {
          id: "timeline",
          label: "Timeline",
          content: <p className="text-dust-700">Every status change.</p>,
        },
        {
          id: "photos",
          label: "Photos",
          content: <p className="text-dust-700">Intake and progress photos.</p>,
        },
      ]}
    />
  );
}
