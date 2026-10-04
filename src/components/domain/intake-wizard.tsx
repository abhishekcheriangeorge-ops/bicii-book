"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { createWorkOrder, listIntakeBikes, searchIntakeOptions } from "@/app/(staff)/jobs/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { SearchPicker, type PickerOption } from "@/components/ui/search-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { jobEconomics } from "@/lib/cult-commons";
import { formatTime } from "@/lib/dates";
import type { ServiceOption } from "@/lib/domain/services";
import type { IntakeBike, IntakeOption } from "@/lib/domain/workshop";
import {
  clearDraft,
  readDraft,
  saveDraft,
  type IntakeDraft,
  type IntakeDraftService,
} from "@/lib/intake-draft";
import { formatMoney, lineTotal, sumMoney } from "@/lib/money";
import { newId } from "@/lib/uuid";

import { BikeSheet } from "./bike-sheet";
import { CustomerSheet } from "./customer-sheet";
import { ShortId } from "./short-id";

export type IntakeWizardProps = {
  /** The signed-in staff member ("Me" among the lead choices). */
  me: { id: string; name: string };
  /** Active staff (D22: only they can be assigned). */
  staff: { id: string; name: string }[];
  /** Active services; `cost` only for view_costs holders. */
  services: ServiceOption[];
  viewCosts: boolean;
  /** The Cult Commons rate in force (view_costs only), for the preview. */
  ccRate: string | null;
  /** From ?customer= / ?bike= (a customer's or a bike's page). */
  preset: { customer: { id: string; label: string } | null; bike: IntakeBike | null };
  currency: string;
};

const STEPS = ["Customer", "Bike", "Work", "People", "Services", "Review"] as const;
const REVIEW = STEPS.length - 1;
/** Above this many services, a search field filters the chips. */
const SEARCH_THRESHOLD = 12;
const MAX_QUANTITY = 99;

/** Which step holds each field a failed create can point at. */
const FIELD_STEP: Record<string, number> = {
  customerId: 0,
  bikeId: 1,
  requestedWork: 2,
  intakeNotes: 2,
  leadId: 3,
  additionalIds: 3,
  services: 4,
};

const noSubscribe = () => () => {};

/**
 * New intake / walk-in (SPEC §7.1, §21, §22), phone first, one step at a
 * time: customer (or a bike, which brings its owner), bike, the work
 * wanted and the bike's condition, the people on it, known services, then
 * a review and "Create job". Photos come straight after, on the job page
 * (the job has to exist before a photo can be recorded against it).
 *
 * The wizard owns the idempotency keys (the job's id and each service
 * line's), so a double tap or a retry after a lost response never makes
 * two jobs. It autosaves to this device (src/lib/intake-draft.ts) and
 * offers the draft back on return. Rendered only in the browser: the draft
 * lives in localStorage.
 */
export function IntakeWizard(props: IntakeWizardProps) {
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  return <Wizard {...props} />;
}

function freshDraft(preset: IntakeWizardProps["preset"]): IntakeDraft {
  return {
    v: 1,
    startedAt: new Date().toISOString(),
    workOrderId: newId(),
    step: preset.customer ? (preset.bike ? 2 : 1) : 0,
    customer: preset.customer,
    bike: preset.bike
      ? { id: preset.bike.id, shortId: preset.bike.shortId, title: preset.bike.title }
      : null,
    requestedWork: "",
    intakeNotes: "",
    leadId: null,
    additionalIds: [],
    services: [],
  };
}

type BikesState = { customerId: string; items: IntakeBike[]; error: string | null };

function Wizard({ me, staff, services, viewCosts, ccRate, preset, currency }: IntakeWizardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<IntakeDraft>(() => freshDraft(preset));
  // A draft left on this device: offered back before anything else.
  const [offer, setOffer] = useState<IntakeDraft | null>(() => readDraft());
  const [bikes, setBikes] = useState<BikesState | null>(null);
  const [customerSheet, setCustomerSheet] = useState(false);
  const [bikeSheet, setBikeSheet] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const finished = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  const step = draft.step;
  const customerId = draft.customer?.id ?? null;

  // Autosave, unless a stored draft is still waiting for Continue/Discard.
  useEffect(() => {
    if (!offer && !finished.current) saveDraft(draft);
  }, [draft, offer]);

  // The chosen customer's bikes.
  useEffect(() => {
    if (!customerId) return;
    let live = true;
    listIntakeBikes({ customerId }).then((r) => {
      if (live) {
        setBikes({ customerId, items: r.ok ? r.data : [], error: r.ok ? null : r.error });
      }
    });
    return () => {
      live = false;
    };
  }, [customerId]);

  // Each new step's heading takes focus (screen readers hear where they are).
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const update = (patch: Partial<IntakeDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const goTo = (next: number) => {
    setStepError(null);
    update({ step: Math.max(0, Math.min(REVIEW, next)) });
  };

  const blocker = (s: number): string | null => {
    if (s === 0 && !draft.customer) return "Choose the customer, or add a new one.";
    if (s === 1 && !draft.bike) return "Choose the bike, or add it.";
    if (s === 2 && !draft.requestedWork.trim()) return "Say what the customer wants done.";
    return null;
  };

  const next = () => {
    const problem = blocker(step);
    if (problem) {
      setStepError(problem);
      return;
    }
    goTo(step + 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || step === REVIEW) return;
    const target = e.target as HTMLElement;
    // Sheets render in a portal: their Enter belongs to their own form.
    if (!e.currentTarget.contains(target)) return;
    if (
      target.tagName === "TEXTAREA" ||
      target.tagName === "BUTTON" ||
      target.tagName === "A" ||
      target.getAttribute("role") === "combobox"
    ) {
      return;
    }
    e.preventDefault();
    next();
  };

  const chooseCustomer = (customer: { id: string; label: string }) => {
    setStepError(null);
    setDraft((d) => ({
      ...d,
      customer,
      // A bike only stays if it is a shop bike chosen first, or theirs.
      bike: d.customer?.id === customer.id ? d.bike : d.bike && !d.customer ? d.bike : null,
      step: 1,
    }));
  };

  const pickOption = (option: IntakeOption | null) => {
    if (!option) return;
    setStepError(null);
    if (option.kind === "customer" && option.customer) {
      chooseCustomer(option.customer);
      return;
    }
    if (option.bike) {
      // A bike brings its owner; a shop bike waits for the customer.
      setDraft((d) => ({
        ...d,
        bike: option.bike,
        customer: option.customer ?? null,
        step: option.customer ? 1 : 0,
      }));
    }
  };

  const toggleService = (s: ServiceOption) =>
    setDraft((d) => ({
      ...d,
      services: d.services.some((x) => x.serviceId === s.id)
        ? d.services.filter((x) => x.serviceId !== s.id)
        : [...d.services, { lineId: newId(), serviceId: s.id, quantity: "1" }],
    }));

  const setQuantity = (serviceId: string, quantity: string) =>
    setDraft((d) => ({
      ...d,
      services: d.services.map((x) => (x.serviceId === serviceId ? { ...x, quantity } : x)),
    }));

  const create = () => {
    for (const s of [0, 1, 2]) {
      const problem = blocker(s);
      if (problem) {
        goTo(s);
        setStepError(problem);
        return;
      }
    }
    startCreate(async () => {
      const r = await createWorkOrder({
        id: draft.workOrderId,
        customerId: draft.customer!.id,
        bikeId: draft.bike!.id,
        requestedWork: draft.requestedWork,
        intakeNotes: draft.intakeNotes,
        leadId: draft.leadId,
        additionalIds: draft.additionalIds.filter((id) => id !== draft.leadId),
        services: draft.services.map((s) => ({
          lineId: s.lineId,
          serviceId: s.serviceId,
          quantity: s.quantity,
        })),
      });
      setResult(r);
      if (!r.ok) {
        const field = Object.keys(r.fieldErrors ?? {}).find((f) => f in FIELD_STEP);
        toast({ title: "Job not created", description: r.error, tone: "error" });
        if (field) {
          setStepError(r.fieldErrors?.[field]?.[0] ?? r.error);
          update({ step: FIELD_STEP[field] });
        }
        return;
      }
      finished.current = true;
      clearDraft();
      toast({ title: `Checked in as ${r.data.jobNumber}`, tone: "success" });
      router.push(`/jobs/${r.data.id}?intake=photos`);
    });
  };

  if (offer) {
    return (
      <Card title="Continue where you left off?">
        <p className="text-dust-700">
          Continue the intake you started at {formatTime(offer.startedAt)}?
          {offer.customer ? ` ${offer.customer.label}` : ""}
          {offer.bike ? ` · ${offer.bike.title}` : ""}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setDraft(offer);
              setOffer(null);
            }}
          >
            Continue
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              clearDraft();
              setOffer(null);
            }}
          >
            Discard
          </Button>
        </div>
      </Card>
    );
  }

  const selectedServices = draft.services
    .map((s) => ({ ...s, service: services.find((x) => x.id === s.serviceId) }))
    .filter((s): s is IntakeDraftService & { service: ServiceOption } => Boolean(s.service));
  const subtotal = sumMoney(
    selectedServices.map((s) => lineTotal(s.quantity, s.service.salePrice, currency)),
  );
  const ccPreview =
    viewCosts && ccRate
      ? jobEconomics(
          selectedServices.map((s) => ({
            quantity: s.quantity,
            unitSalePrice: s.service.salePrice,
            unitDirectCost: s.service.cost ?? "0",
            rate: ccRate,
          })),
        ).ccShare
      : null;
  const bikeList = bikes && bikes.customerId === customerId ? bikes.items : customerId ? null : [];
  const lead = staff.find((s) => s.id === draft.leadId) ?? null;
  const additional = staff.filter(
    (s) => draft.additionalIds.includes(s.id) && s.id !== draft.leadId,
  );
  const failed = result && !result.ok ? result : null;

  return (
    // Enter advances the wizard (SPEC §22: keyboard on desktop/iPad); every
    // control keeps its own keys.
    <div className="flex flex-col gap-5" onKeyDown={onKeyDown}>
      <nav aria-label="Intake steps" className="flex flex-col gap-2">
        <p className="eyebrow text-dust-500">
          {step === REVIEW ? "Review" : `Step ${step + 1} of ${REVIEW}`}
        </p>
        <ol className="flex gap-1.5" aria-hidden="true">
          {STEPS.map((name, i) => (
            <li
              key={name}
              className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-ink" : "bg-dust-200")}
            />
          ))}
        </ol>
      </nav>

      <section aria-labelledby="intake-step" className="flex flex-col gap-4">
        <h2 id="intake-step" ref={headingRef} tabIndex={-1} className="text-3xl focus:outline-none">
          {STEPS[step]}
        </h2>
        {stepError ? (
          <p role="alert" className="text-sm font-medium text-danger-deep">
            {stepError}
          </p>
        ) : null}

        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <Field label="Find the customer or bike" hint="Name, phone, email, B- number or serial">
              <SearchPicker<PickerOption & { option: IntakeOption }>
                search={async (q) => {
                  const r = await searchIntakeOptions({ q });
                  if (!r.ok) throw new Error(r.error);
                  return r.data.map((o) => ({
                    id: o.id,
                    label: o.label,
                    description: o.description,
                    meta: o.meta,
                    option: o,
                  }));
                }}
                value={null}
                onSelect={(picked) => pickOption(picked?.option ?? null)}
                minChars={2}
                debounceMs={250}
                placeholder="Search customers and bikes"
                emptyMessage="No customer or bike matches. Add a new customer."
                action={{
                  label: (q) => `New customer “${q}”`,
                  onSelect: () => setCustomerSheet(true),
                }}
              />
            </Field>
            <div>
              <Button
                variant="outline"
                icon={<PlusIcon className="size-5" />}
                onClick={() => setCustomerSheet(true)}
              >
                New customer
              </Button>
            </div>
            {draft.customer ? (
              <p className="text-dust-700">
                Customer: <span className="font-medium text-ink">{draft.customer.label}</span>
              </p>
            ) : null}
            {draft.bike && !draft.customer ? (
              <p className="rounded-xl bg-info-soft p-3 text-info-deep">
                Shop bike {draft.bike.shortId} ({draft.bike.title}) chosen. Now find the customer it
                is for.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 1 && draft.customer ? (
          <div className="flex flex-col gap-4">
            <p className="text-dust-700">
              Bikes of <span className="font-medium text-ink">{draft.customer.label}</span>
            </p>
            {bikes?.error && bikes.customerId === customerId ? (
              <p role="alert" className="text-sm text-danger-deep">
                {bikes.error}
              </p>
            ) : null}
            {bikeList === null ? (
              <Skeleton className="h-20" />
            ) : (
              <BikeChoices
                bikes={withChosen(bikeList, draft.bike)}
                chosenId={draft.bike?.id ?? null}
                onChoose={(b) => {
                  setStepError(null);
                  update({ bike: { id: b.id, shortId: b.shortId, title: b.title } });
                }}
              />
            )}
            <div>
              <Button
                variant="outline"
                icon={<PlusIcon className="size-5" />}
                onClick={() => setBikeSheet(true)}
              >
                Add bike
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-5">
            <Field
              label="Requested work"
              hint="What the customer asked for, in their words."
              required
            >
              <Textarea
                name="requestedWork"
                rows={4}
                maxLength={2_000}
                value={draft.requestedWork}
                onChange={(e) => update({ requestedWork: e.target.value })}
              />
            </Field>
            <Field
              label="Condition on arrival"
              hint="Scratches, damage, missing parts: anything to note before work starts."
            >
              <Textarea
                name="intakeNotes"
                rows={3}
                maxLength={5_000}
                value={draft.intakeNotes}
                onChange={(e) => update({ intakeNotes: e.target.value })}
              />
            </Field>
          </div>
        ) : null}

        {step === 3 ? (
          <PeopleStep
            me={me}
            staff={staff}
            leadId={draft.leadId}
            additionalIds={draft.additionalIds}
            onLead={(leadId) =>
              setDraft((d) => ({
                ...d,
                leadId,
                additionalIds: d.additionalIds.filter((id) => id !== leadId),
              }))
            }
            onToggleAdditional={(id) =>
              setDraft((d) => ({
                ...d,
                additionalIds: d.additionalIds.includes(id)
                  ? d.additionalIds.filter((x) => x !== id)
                  : [...d.additionalIds, id],
              }))
            }
          />
        ) : null}

        {step === 4 ? (
          <ServicesStep
            services={services}
            selected={draft.services}
            currency={currency}
            onToggle={toggleService}
            onQuantity={setQuantity}
            subtotal={formatMoney(subtotal, currency)}
            ccPreview={ccPreview ? formatMoney(ccPreview, currency) : null}
          />
        ) : null}

        {step === REVIEW ? (
          <div className="flex flex-col gap-3">
            {failed ? (
              <p role="alert" className="text-sm font-medium text-danger-deep">
                {failed.error}
              </p>
            ) : null}
            <ReviewRow label="Customer" onEdit={() => goTo(0)}>
              {draft.customer?.label ?? "—"}
            </ReviewRow>
            <ReviewRow label="Bike" onEdit={() => goTo(1)}>
              {draft.bike ? (
                <>
                  {draft.bike.title}{" "}
                  {draft.bike.shortId ? <ShortId value={draft.bike.shortId} /> : null}
                </>
              ) : (
                "—"
              )}
            </ReviewRow>
            <ReviewRow label="Work" onEdit={() => goTo(2)}>
              <span className="whitespace-pre-line">{draft.requestedWork}</span>
              {draft.intakeNotes.trim() ? (
                <span className="mt-1 block text-sm whitespace-pre-line text-dust-700">
                  Condition: {draft.intakeNotes}
                </span>
              ) : null}
            </ReviewRow>
            <ReviewRow label="People" onEdit={() => goTo(3)}>
              Lead: {lead ? lead.name : "Unassigned"}
              {additional.length > 0 ? (
                <span className="block text-sm text-dust-700">
                  Also: {additional.map((a) => a.name).join(", ")}
                </span>
              ) : null}
            </ReviewRow>
            <ReviewRow label="Services" onEdit={() => goTo(4)}>
              {selectedServices.length === 0 ? (
                "None yet"
              ) : (
                <>
                  <ul>
                    {selectedServices.map((s) => (
                      <li key={s.serviceId}>
                        {s.service.name}
                        {s.quantity !== "1" ? ` × ${s.quantity}` : ""}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-1 block text-sm text-dust-700 tabular-nums">
                    Subtotal {formatMoney(subtotal, currency)}
                  </span>
                </>
              )}
            </ReviewRow>
          </div>
        ) : null}
      </section>

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 -mx-1 flex justify-between gap-3 rounded-full bg-paper/95 p-1 backdrop-blur md:bottom-4">
        <Button variant="outline" disabled={step === 0 || creating} onClick={() => goTo(step - 1)}>
          Back
        </Button>
        {step === REVIEW ? (
          <Button pending={creating} pendingLabel="Creating…" onClick={create}>
            Create job
          </Button>
        ) : (
          <Button onClick={next}>Next</Button>
        )}
      </div>

      <CustomerSheet
        open={customerSheet}
        onOpenChange={setCustomerSheet}
        onCreated={chooseCustomer}
      />
      {draft.customer ? (
        <BikeSheet
          open={bikeSheet}
          onOpenChange={setBikeSheet}
          owner={draft.customer}
          onCreated={({ id, label }) => {
            const owner = draft.customer!.id;
            update({ bike: { id, shortId: "", title: label } });
            listIntakeBikes({ customerId: owner }).then((r) => {
              if (!r.ok) return;
              setBikes({ customerId: owner, items: r.data, error: null });
              const added = r.data.find((b) => b.id === id);
              if (added) {
                setDraft((d) =>
                  d.bike?.id === id
                    ? { ...d, bike: { id, shortId: added.shortId, title: added.title } }
                    : d,
                );
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** The customer's bikes, plus a chosen bike that is not theirs (a shop bike). */
function withChosen(list: IntakeBike[], chosen: IntakeDraft["bike"]): IntakeBike[] {
  if (!chosen || list.some((b) => b.id === chosen.id)) return list;
  return [...list, { ...chosen, colour: null, openJob: null }];
}

function BikeChoices({
  bikes,
  chosenId,
  onChoose,
}: {
  bikes: IntakeBike[];
  chosenId: string | null;
  onChoose: (bike: IntakeBike) => void;
}) {
  if (bikes.length === 0) {
    return <p className="text-dust-500">No bikes yet. Add the bike they brought in.</p>;
  }
  return (
    <ul aria-label="Bikes" className="grid gap-2 sm:grid-cols-2">
      {bikes.map((b) => {
        const chosen = b.id === chosenId;
        return (
          <li key={b.id}>
            <button
              type="button"
              aria-pressed={chosen}
              onClick={() => onChoose(b)}
              className={cn(
                "flex min-h-20 w-full cursor-pointer flex-col items-start gap-1 rounded-2xl border-2 px-4 py-3 text-left transition-colors",
                chosen ? "border-ink bg-dust-100" : "border-hairline bg-card hover:bg-dust-100",
              )}
            >
              <span className="font-semibold">{b.title}</span>
              <span className="flex flex-wrap items-center gap-2 text-sm text-dust-500">
                {b.shortId ? <ShortId value={b.shortId} /> : null}
                {b.colour ? <span>{b.colour}</span> : null}
                {b.openJob ? <Badge tone="waiting">Open job {b.openJob.jobNumber}</Badge> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Chip({
  pressed,
  onClick,
  children,
  role,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** "radio" for a single choice (lead); a toggle button otherwise. */
  role?: "radio";
  label?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "radio" ? pressed : undefined}
      aria-pressed={role === "radio" ? undefined : pressed}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold transition-colors",
        pressed ? "border-ink bg-ink text-paper" : "border-hairline bg-card hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}

function PeopleStep({
  me,
  staff,
  leadId,
  additionalIds,
  onLead,
  onToggleAdditional,
}: {
  me: { id: string; name: string };
  staff: { id: string; name: string }[];
  leadId: string | null;
  additionalIds: string[];
  onLead: (id: string | null) => void;
  onToggleAdditional: (id: string) => void;
}) {
  const ordered = [...staff.filter((s) => s.id === me.id), ...staff.filter((s) => s.id !== me.id)];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 id="lead-label" className="font-display text-xs font-bold tracking-wide uppercase">
          Lead mechanic
        </h3>
        <div role="radiogroup" aria-labelledby="lead-label" className="flex flex-wrap gap-2">
          {ordered.map((s) => (
            <Chip
              key={s.id}
              role="radio"
              pressed={leadId === s.id}
              onClick={() => onLead(s.id)}
              label={s.id === me.id ? `Me (${s.name})` : s.name}
            >
              {s.id === me.id ? "Me" : s.name}
            </Chip>
          ))}
          <Chip role="radio" pressed={leadId === null} onClick={() => onLead(null)}>
            Unassigned
          </Chip>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3
          id="additional-label"
          className="font-display text-xs font-bold tracking-wide uppercase"
        >
          Additional staff
        </h3>
        <div role="group" aria-labelledby="additional-label" className="flex flex-wrap gap-2">
          {ordered
            .filter((s) => s.id !== leadId)
            .map((s) => (
              <Chip
                key={s.id}
                pressed={additionalIds.includes(s.id)}
                onClick={() => onToggleAdditional(s.id)}
                label={s.id === me.id ? `Me (${s.name})` : s.name}
              >
                {s.id === me.id ? "Me" : s.name}
              </Chip>
            ))}
        </div>
        <p className="text-sm text-dust-500">Optional. Anyone can be added or changed later.</p>
      </div>
    </div>
  );
}

function ServicesStep({
  services,
  selected,
  currency,
  onToggle,
  onQuantity,
  subtotal,
  ccPreview,
}: {
  services: ServiceOption[];
  selected: IntakeDraftService[];
  currency: string;
  onToggle: (s: ServiceOption) => void;
  onQuantity: (serviceId: string, quantity: string) => void;
  subtotal: string;
  ccPreview: string | null;
}) {
  const [filter, setFilter] = useState("");
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = services.filter((s) =>
    words.every((w) => `${s.name} ${s.categoryName}`.toLowerCase().includes(w)),
  );
  const groups = [...new Set(shown.map((s) => s.categoryName))].map((name) => ({
    name,
    items: shown.filter((s) => s.categoryName === name),
  }));
  const picked = selected
    .map((s) => ({ ...s, service: services.find((x) => x.id === s.serviceId) }))
    .filter((s): s is IntakeDraftService & { service: ServiceOption } => Boolean(s.service));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-dust-700">
        Optional: the services you already know it needs. Add more on the job at any time.
      </p>
      {services.length > SEARCH_THRESHOLD ? (
        <Field label="Filter services">
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            prefix={<SearchIcon className="size-5" />}
            autoComplete="off"
          />
        </Field>
      ) : null}
      {services.length === 0 ? (
        <p className="text-dust-500">No active services yet. An admin adds them in Settings.</p>
      ) : null}
      {groups.map((g) => (
        <div key={g.name} role="group" aria-label={g.name} className="flex flex-col gap-2">
          <h3 className="font-display text-xs font-bold tracking-wide uppercase">{g.name}</h3>
          <div className="flex flex-wrap gap-2">
            {g.items.map((s) => (
              <Chip
                key={s.id}
                pressed={selected.some((x) => x.serviceId === s.id)}
                onClick={() => onToggle(s)}
              >
                {s.name}
                <span className="font-normal tabular-nums opacity-80">
                  {formatMoney(s.salePrice, s.currency)}
                </span>
              </Chip>
            ))}
          </div>
        </div>
      ))}
      {picked.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4">
          <ul aria-label="Chosen services" className="flex flex-col gap-3">
            {picked.map((s) => (
              <li key={s.serviceId} className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 flex-1 font-medium">{s.service.name}</span>
                <span className="w-44">
                  <NumberInput
                    kind="quantity"
                    stepper
                    minValue={1}
                    maxValue={MAX_QUANTITY}
                    aria-label={`Quantity of ${s.service.name}`}
                    value={s.quantity}
                    onValueChange={(v) =>
                      onQuantity(
                        s.serviceId,
                        /^\d{1,2}$/.test(v) && v !== "0" ? String(Number(v)) : "1",
                      )
                    }
                  />
                </span>
                <span className="w-24 text-right font-semibold tabular-nums">
                  {formatMoney(lineTotal(s.quantity, s.service.salePrice, currency), currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex items-baseline justify-between border-t border-hairline pt-3 tabular-nums">
            <span className="text-sm text-dust-700">Subtotal (preview)</span>
            <span className="text-lg font-bold">{subtotal}</span>
          </p>
          {ccPreview ? (
            <p className="flex items-baseline justify-between text-sm tabular-nums">
              <span className="text-dust-700">Cult Commons (preview)</span>
              <span className="font-medium">{ccPreview}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-hairline bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="eyebrow text-dust-500">{label}</p>
        <div className="mt-1">{children}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`}>
        Edit
      </Button>
    </div>
  );
}
