"use client";

import Image from "next/image";
import {
  useActionState,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  deletePhoto,
  setPhotoCaption,
  setPhotoVisibility,
} from "@/app/(staff)/attachments/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions";
import { visibilityOptions, type Visibility } from "@/lib/attachments";
import { formatDateTime } from "@/lib/dates";
import type { Photo } from "@/lib/domain/attachments";
import { formatBytes } from "@/lib/images";

/** Clicks this soon after the delete confirmation opens are ignored (a double tap). */
const CONFIRM_GUARD_MS = 400;

/**
 * One photo, enlarged, with what staff can change about it: its caption,
 * who may see it (internal / customer / public, each explained; PLAN D13:
 * never public on a customer record) and deleting it with a reason.
 */
export function PhotoViewer({
  photo,
  index,
  onClose,
  onBroken,
}: {
  photo: Photo;
  index: number;
  onClose: () => void;
  onBroken: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Photo ${index + 1}`}
      description={`Added ${formatDateTime(photo.createdAt)}${
        photo.byteSize ? ` · ${formatBytes(photo.byteSize)}` : ""
      }${photo.width && photo.height ? ` · ${photo.width}×${photo.height}` : ""}`}
    >
      <div className="flex flex-col gap-6">
        <figure className="flex flex-col gap-2">
          {photo.url ? (
            <a
              href={photo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-xl bg-ink"
            >
              <Image
                src={photo.url}
                alt={photo.caption ?? `Photo ${index + 1}`}
                width={photo.width ?? 1200}
                height={photo.height ?? 900}
                unoptimized
                onError={onBroken}
                className="mx-auto max-h-[55dvh] w-auto object-contain"
              />
              <span className="sr-only">(opens full size in a new tab)</span>
            </a>
          ) : (
            <p className="rounded-xl bg-sunken p-6 text-center text-dust-500">
              This photo can&rsquo;t be shown right now.
            </p>
          )}
          {photo.caption ? (
            <figcaption className="text-sm text-dust-700">{photo.caption}</figcaption>
          ) : null}
        </figure>
        <VisibilityControl photo={photo} />
        <CaptionForm photo={photo} />
        <DeleteControl photo={photo} onDeleted={onClose} />
      </div>
    </Sheet>
  );
}

function VisibilityControl({ photo }: { photo: Photo }) {
  const { toast } = useToast();
  const [optimistic, setOptimistic] = useOptimistic(photo.visibility);
  const [pending, start] = useTransition();
  const options = visibilityOptions(photo.entityType);
  const current = options.find((o) => o.value === optimistic) ?? options[0];
  const blocked = options.filter((o) => o.blocked);
  const labelId = useId();

  const change = (next: Visibility) => {
    if (next === optimistic) return;
    start(async () => {
      setOptimistic(next);
      const result = await setPhotoVisibility({ attachmentId: photo.id, visibility: next });
      if (result.ok) {
        toast({
          title: `Photo is now ${options.find((o) => o.value === next)?.label.toLowerCase()}`,
          tone: "success",
        });
      } else {
        toast({
          title: "Visibility not changed",
          description: result.error,
          tone: "error",
          action: { label: "Retry", onAction: () => change(next) },
        });
      }
    });
  };

  return (
    <section
      aria-labelledby={labelId}
      className="flex flex-col gap-2"
      aria-busy={pending || undefined}
    >
      <h3 id={labelId} className="font-display text-xs font-bold tracking-wide uppercase">
        Who can see this photo
      </h3>
      <SegmentedControl
        label="Who can see this photo"
        value={optimistic}
        onValueChange={change}
        options={options.map((o) => ({
          value: o.value,
          label: o.label,
          disabled: Boolean(o.blocked),
        }))}
      />
      <p className="text-sm text-dust-700">
        <span className="font-medium">{current.label}:</span> {current.description}
      </p>
      {blocked.map((o) => (
        <p key={o.value} className="text-sm text-dust-500">
          {o.blocked}
        </p>
      ))}
    </section>
  );
}

type CaptionState = ActionResult | null;

function CaptionForm({ photo }: { photo: Photo }) {
  const { toast } = useToast();
  const [state, formAction, pending] = useActionState<CaptionState, FormData>(
    async (prev, formData) => {
      const result = await setPhotoCaption(prev, formData);
      if (result.ok) toast({ title: "Caption saved", tone: "success" });
      return result;
    },
    null,
  );
  const values = state && !state.ok ? state.values : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="attachmentId" value={photo.id} />
      <Field
        label="Caption"
        hint="Optional. Customers see it with the photo if it is shared with them."
        error={state && !state.ok ? (state.fieldErrors?.caption?.[0] ?? state.error) : undefined}
      >
        <Textarea
          name="caption"
          rows={2}
          maxLength={500}
          defaultValue={values?.caption ?? photo.caption ?? ""}
        />
      </Field>
      <div>
        <Button type="submit" variant="outline" size="sm" pending={pending} pendingLabel="Saving…">
          Save caption
        </Button>
      </div>
    </form>
  );
}

function DeleteControl({ photo, onDeleted }: { photo: Photo; onDeleted: () => void }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const openedAt = useRef(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (confirming) reasonRef.current?.focus();
  }, [confirming]);

  const remove = (why: string) => {
    start(async () => {
      const result = await deletePhoto({ attachmentId: photo.id, reason: why });
      if (result.ok) {
        toast({ title: "Photo deleted", tone: "success" });
        onDeleted();
        return;
      }
      const fieldError = result.fieldErrors?.reason?.[0];
      if (fieldError) {
        setError(fieldError);
        reasonRef.current?.focus();
        return;
      }
      toast({
        title: "Photo not deleted",
        description: result.error,
        tone: "error",
        action: { label: "Retry", onAction: () => remove(why) },
      });
    });
  };

  const confirm = () => {
    if (Date.now() - openedAt.current < CONFIRM_GUARD_MS) return;
    if (!reason.trim()) {
      setError("Say why you are deleting this photo.");
      reasonRef.current?.focus();
      return;
    }
    remove(reason);
  };

  if (!confirming) {
    return (
      <div key="start" className="border-t border-hairline pt-4">
        <Button
          key="delete"
          variant="ghost"
          size="sm"
          className="text-danger-deep"
          onClick={() => {
            openedAt.current = Date.now();
            setReason("");
            setError(undefined);
            setConfirming(true);
          }}
        >
          Delete photo…
        </Button>
      </div>
    );
  }
  return (
    <div key="confirm" className="flex flex-col gap-3 border-t border-hairline pt-4">
      <Field
        label="Why are you deleting this photo?"
        hint="Kept in the photo history with your name."
        error={error}
        required
      >
        <Textarea
          ref={reasonRef}
          name="reason"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(undefined);
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button key="cancel" variant="outline" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button
          key="confirm-delete"
          variant="danger"
          pending={pending}
          pendingLabel="Deleting…"
          onClick={confirm}
        >
          Delete photo
        </Button>
      </div>
    </div>
  );
}
