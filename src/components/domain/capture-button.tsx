"use client";

import Image from "next/image";
import { useEffect, useRef, type ChangeEvent, type ReactNode } from "react";

import { buttonClasses, type ButtonVariant } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { AlertIcon, CameraIcon, CheckIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import type { PhotoTarget } from "@/lib/attachments";
import { cn } from "@/lib/cn";

import { usePhotoUploads, type PendingUpload } from "./photo-uploads";

/**
 * The camera control used everywhere photos are taken (SPEC §8, §22:
 * camera actions prominent). "Take photo" opens the rear camera directly on
 * phones (`capture="environment"`); "Choose photos" picks several from the
 * library. Each photo is downscaled on the device, uploaded straight to
 * Storage with progress, and recorded; its thumbnail shows at once and a
 * failure keeps it with Retry and Discard (upload-store.ts). The queue
 * belongs to the staff layout, so photos still uploading or failed show
 * here again when staff come back to the record.
 *
 * `hiddenIds` are photos the page already shows, so a finished upload's
 * thumbnail gives way to the real one when the page refreshes. `empty`
 * shows while nothing is uploading (e.g. "No photos yet").
 */
export function CaptureButton({
  target,
  hiddenIds = [],
  disabled = false,
  empty,
}: {
  target: PhotoTarget;
  hiddenIds?: readonly string[];
  disabled?: boolean;
  empty?: ReactNode;
}) {
  const { items, addFiles, retry, discard, forgetShown } = usePhotoUploads(target);
  const shown = items.filter(
    (it) => !(it.status === "done" && it.attachmentId && hiddenIds.includes(it.attachmentId)),
  );
  // Saved photos the page now shows itself leave the queue.
  const hiddenKey = hiddenIds.join(",");
  useEffect(() => {
    if (hiddenKey) forgetShown(hiddenKey.split(","));
  }, [hiddenKey, forgetShown]);
  const busy = items.filter((it) => it.status !== "done" && it.status !== "failed").length;

  return (
    <div className="flex flex-col gap-3">
      {shown.length > 0 ? (
        <ul aria-label="Photos being added" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {shown.map((item) => (
            <PendingTile key={item.key} item={item} onRetry={retry} onDiscard={discard} />
          ))}
        </ul>
      ) : (
        empty
      )}
      <div className="flex flex-wrap gap-2">
        <FilePick
          label="Take photo"
          icon={<CameraIcon className="size-5" />}
          variant="accent"
          capture
          disabled={disabled}
          onFiles={addFiles}
        />
        <FilePick
          label="Choose photos"
          icon={<PlusIcon className="size-5" />}
          variant="outline"
          multiple
          disabled={disabled}
          onFiles={addFiles}
        />
      </div>
      <p role="status" className="text-sm text-dust-500 empty:hidden">
        {busy > 0 ? `Saving ${busy} photo${busy === 1 ? "" : "s"}…` : ""}
      </p>
    </div>
  );
}

/**
 * A button-looking label around a visually hidden file input, so the
 * native picker (and the camera) opens on tap and the input stays the
 * focusable, labelled control.
 */
function FilePick({
  label,
  icon,
  variant,
  capture = false,
  multiple = false,
  disabled,
  onFiles,
}: {
  label: string;
  icon: ReactNode;
  variant: ButtonVariant;
  capture?: boolean;
  multiple?: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    // Clear it so picking the same file again fires change again.
    input.value = "";
    onFiles(files);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => take(e.currentTarget);

  // A photo taken before the page finished loading (slow connection) is
  // already in the input when React attaches; pick it up instead of
  // losing it.
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });
  useEffect(() => {
    const input = inputRef.current;
    if (input?.files?.length) {
      const files = Array.from(input.files);
      input.value = "";
      onFilesRef.current(files);
    }
  }, []);
  return (
    <label
      aria-disabled={disabled || undefined}
      className={buttonClasses({
        variant,
        className:
          "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-indigo",
      })}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={capture ? "environment" : undefined}
        multiple={multiple}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      {icon}
      {label}
    </label>
  );
}

function statusText(item: PendingUpload): string {
  switch (item.status) {
    case "preparing":
      return "Preparing";
    case "uploading":
      return `Uploading ${Math.round(item.progress * 100)}%`;
    case "saving":
      return "Saving";
    case "done":
      return "Saved";
    case "failed":
      return "Not saved";
  }
}

function PendingTile({
  item,
  onRetry,
  onDiscard,
}: {
  item: PendingUpload;
  onRetry: (key: string) => void;
  onDiscard: (key: string) => void;
}) {
  const failed = item.status === "failed";
  const done = item.status === "done";
  const text = statusText(item);
  return (
    <li
      className="relative aspect-square overflow-hidden rounded-xl bg-sunken"
      aria-label={`${item.label}: ${text}${item.error ? `. ${item.error}` : ""}`}
    >
      <Image
        src={item.previewUrl}
        alt=""
        width={300}
        height={300}
        unoptimized
        className={cn("size-full object-cover", !done && "opacity-60")}
      />
      {failed ? (
        <div className="absolute inset-0 flex flex-col justify-between bg-danger/85 p-1 text-danger-fg">
          <div className="flex items-start justify-between gap-1">
            <AlertIcon className="m-2 size-5 shrink-0" />
            <IconButton
              aria-label={`Discard ${item.label.toLowerCase()}`}
              icon={<CloseIcon className="size-4" />}
              variant="inherit"
              onClick={() => onDiscard(item.key)}
            />
          </div>
          {item.retryable ? (
            <button
              type="button"
              onClick={() => onRetry(item.key)}
              className="min-h-tap w-full cursor-pointer rounded-lg bg-paper font-display text-xs font-bold tracking-wide text-ink uppercase"
            >
              Retry
            </button>
          ) : (
            <p className="p-1 text-xs font-medium">{item.error}</p>
          )}
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-ink/70 px-2 py-1.5 text-paper">
          <span aria-hidden="true" className="flex items-center gap-1.5 text-xs font-medium">
            {done ? <CheckIcon className="size-3.5" /> : <Spinner className="size-3.5" />}
            {text}
          </span>
          {item.status === "uploading" ? (
            <span
              role="progressbar"
              aria-label={`Uploading ${item.label.toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(item.progress * 100)}
              className="block h-1 overflow-hidden rounded-full bg-paper/30"
            >
              <span
                className="block h-full rounded-full bg-yellow transition-[width] duration-200"
                style={{ width: `${Math.round(item.progress * 100)}%` }}
              />
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}
