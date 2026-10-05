import type { ActionResult } from "@/lib/actions";
import type { PhotoTarget } from "@/lib/attachments";
import type { ToastOptions } from "@/components/ui/toast";

import { PhotoRejected, type PreparedPhoto } from "./prepare-photo";

/**
 * The photo upload queue behind every CaptureButton (ADR-001 A7), one per
 * staff app, outliving the screen that started an upload: it lives in
 * PhotoUploadsProvider in the staff layout, next to the toasts. Each
 * picked or captured photo goes through
 *
 *   preparing  decode, orient, downscale, re-encode (prepare-photo.ts)
 *   uploading  the server mints a signed upload URL for a new attachment
 *              id; the browser uploads straight to Storage, with progress
 *   saving     the server records it (record_attachment checks the object)
 *   done       recorded; the record's page refreshes once its queue drains
 *              (not once per photo: every refresh re-signs every photo)
 *
 * Nothing is lost silently. A failure keeps the photo (in memory, with its
 * preview) on its tile, with Retry and Discard, whenever its record is on
 * screen, now or after coming back to it; one toast per record ("3 photos
 * not saved", Retry all) updates in place and is never pushed out by other
 * toasts; the header says how many photos are unsaved, on every screen,
 * and links back; closing or reloading the tab while any photo is unsaved
 * asks first. Retry resumes at the failed step: an upload that landed is
 * never repeated (only recording is retried, which is replay-safe), unless
 * the server says the object is missing.
 */

export type UploadStatus = "preparing" | "uploading" | "saving" | "done" | "failed";

export type PendingUpload = {
  key: string;
  /** "New photo 3": camera captures are all called image.jpg. */
  label: string;
  /** `{entityType}:{entityId}` of the record it is for. */
  targetKey: string;
  target: PhotoTarget;
  /** Object URL of the picked file, for the optimistic thumbnail. */
  previewUrl: string;
  status: UploadStatus;
  /** 0..1 while uploading. */
  progress: number;
  error: string | null;
  /** False when retrying cannot help (not a photo, refused by Storage). */
  retryable: boolean;
  attachmentId: string | null;
};

export type UploadTargetInfo = {
  attachmentId: string;
  bucket: string;
  path: string;
  token: string;
  mediaType: PreparedPhoto["mediaType"];
};

type StorageError = { message?: string; statusCode?: string; status?: number };

/** What the queue needs from the outside world (injected, so it is testable). */
export type UploadDeps = {
  preparePhoto: (file: File) => Promise<PreparedPhoto>;
  prepareUploads: (
    input: PhotoTarget & { mediaTypes: PreparedPhoto["mediaType"][] },
  ) => Promise<ActionResult<UploadTargetInfo[]>>;
  upload: (
    target: UploadTargetInfo,
    blob: Blob,
    onProgress: (fraction: number) => void,
  ) => Promise<{ error: StorageError | null }>;
  recordPhoto: (
    input: PhotoTarget & {
      attachmentId: string;
      path: string;
      mediaType: PreparedPhoto["mediaType"];
      byteSize: number | null;
      width: number | null;
      height: number | null;
    },
  ) => Promise<ActionResult<unknown>>;
  createPreview: (file: File) => string;
  revokePreview: (url: string) => void;
  newKey: () => string;
  now: () => number;
};

/** How the queue talks to staff and the page (set by the provider once mounted). */
export type UploadUi = {
  toast: (options: ToastOptions) => void;
  dismissToast: (key: string) => void;
  /** Re-render the current page (router.refresh). */
  refresh: () => void;
};

type Job = {
  file: File;
  prepared?: PreparedPhoto;
  upload?: UploadTargetInfo & { mintedAt: number };
  /** The object is in Storage (uploaded, or Storage said it already was). */
  uploaded: boolean;
  running: boolean;
};

/** Signed upload URLs last two hours; mint a new one well before that. */
export const UPLOAD_URL_MAX_AGE_MS = 90 * 60 * 1000;
/** Photos processed at once (decode and upload); Server Actions queue anyway. */
const CONCURRENCY = 2;

const CONNECTION = "The upload did not go through. Check the connection.";

class UploadFailed extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

export const targetKeyOf = (t: PhotoTarget) => `${t.entityType}:${t.entityId}`;
const failureToastKey = (targetKey: string) => `photo-uploads:${targetKey}`;
const savedToastKey = (targetKey: string) => `photo-uploads-saved:${targetKey}`;

function storageStatus(error: StorageError): number | null {
  const code = Number(error.statusCode ?? error.status);
  return Number.isFinite(code) && code > 0 ? code : null;
}

function isAlreadyThere(error: StorageError) {
  return storageStatus(error) === 409 || /already exists|duplicate/i.test(error.message ?? "");
}

/** Turns a Storage upload error into what staff are told, and whether Retry can help. */
function uploadFailure(error: StorageError, job: Job): UploadFailed {
  const status = storageStatus(error);
  const message = error.message ?? "";
  if (status === 413 || status === 415 || /mime|content type|too large|size/i.test(message)) {
    return new UploadFailed(
      "Storage did not accept this file. Save it as a JPEG and add it again.",
      false,
    );
  }
  if (status !== null && status >= 400 && status < 500) {
    // The link was refused (expired, say): the next try mints a new one.
    job.upload = undefined;
    return new UploadFailed("The upload link was refused. Retry to get a new one.");
  }
  return new UploadFailed(CONNECTION);
}

export class UploadStore {
  private items: PendingUpload[] = [];
  private readonly jobs = new Map<string, Job>();
  private queue: string[] = [];
  private active = 0;
  private readonly listeners = new Set<() => void>();
  private readonly watchers = new Map<string, number>();
  private readonly counters = new Map<string, number>();
  private ui: UploadUi | null = null;

  constructor(private readonly deps: UploadDeps) {}

  // --- external store (useSyncExternalStore) -------------------------------
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getItems = (): readonly PendingUpload[] => this.items;

  setUi(ui: UploadUi | null) {
    this.ui = ui;
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private patch(key: string, patch: Partial<PendingUpload>) {
    this.items = this.items.map((it) => (it.key === key ? { ...it, ...patch } : it));
    this.emit();
  }

  private item(key: string) {
    return this.items.find((it) => it.key === key);
  }

  /** Photos not yet recorded (uploading or failed), over every record. */
  unsaved(): PendingUpload[] {
    return this.items.filter((it) => it.status !== "done");
  }

  /**
   * A record whose photos are on screen (CaptureButton mounted): its queue
   * draining refreshes the page instead of toasting "saved".
   */
  watch(target: PhotoTarget): () => void {
    const tk = targetKeyOf(target);
    this.watchers.set(tk, (this.watchers.get(tk) ?? 0) + 1);
    return () => {
      const n = (this.watchers.get(tk) ?? 1) - 1;
      if (n > 0) this.watchers.set(tk, n);
      else this.watchers.delete(tk);
    };
  }

  add(target: PhotoTarget, files: File[]) {
    if (files.length === 0) return;
    const tk = targetKeyOf(target);
    const added = files.map((file): PendingUpload => {
      const key = this.deps.newKey();
      const n = (this.counters.get(tk) ?? 0) + 1;
      this.counters.set(tk, n);
      this.jobs.set(key, { file, uploaded: false, running: false });
      this.queue.push(key);
      return {
        key,
        label: `New photo ${n}`,
        targetKey: tk,
        target,
        previewUrl: this.deps.createPreview(file),
        status: "preparing",
        progress: 0,
        error: null,
        retryable: true,
        attachmentId: null,
      };
    });
    this.items = [...this.items, ...added];
    this.emit();
    this.pump();
  }

  retry(key: string) {
    const job = this.jobs.get(key);
    if (!job || job.running || this.queue.includes(key)) return;
    const it = this.item(key);
    if (!it || it.status !== "failed" || !it.retryable) return;
    this.patch(key, { status: job.prepared ? "uploading" : "preparing", error: null });
    this.queue.push(key);
    this.notifyFailures(it.targetKey);
    this.pump();
  }

  retryAll(targetKey: string) {
    for (const it of this.items) {
      if (it.targetKey === targetKey && it.status === "failed" && it.retryable) this.retry(it.key);
    }
  }

  /** Forget a failed photo (staff chose to). */
  discard(key: string) {
    const job = this.jobs.get(key);
    if (job?.running) return;
    const it = this.item(key);
    this.jobs.delete(key);
    this.queue = this.queue.filter((k) => k !== key);
    this.items = this.items.filter((x) => x.key !== key);
    if (it) this.deps.revokePreview(it.previewUrl);
    this.emit();
    if (it) this.notifyFailures(it.targetKey);
  }

  /** Drop saved photos the page now shows itself. */
  forgetShown(attachmentIds: readonly string[]) {
    const gone = this.items.filter(
      (it) => it.status === "done" && it.attachmentId && attachmentIds.includes(it.attachmentId),
    );
    if (gone.length === 0) return;
    for (const it of gone) this.deps.revokePreview(it.previewUrl);
    this.items = this.items.filter((it) => !gone.includes(it));
    this.emit();
  }

  private pump() {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const key = this.queue.shift()!;
      this.active++;
      void this.run(key).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(key: string): Promise<void> {
    const job = this.jobs.get(key);
    const it = this.item(key);
    if (!job || !it || job.running) return;
    job.running = true;
    const target = it.target;
    try {
      if (!job.prepared) {
        this.patch(key, { status: "preparing", error: null, progress: 0 });
        job.prepared = await this.deps.preparePhoto(job.file);
      }
      const prepared = job.prepared;

      // A new upload URL only for an object that has not landed: once it
      // is in Storage, only recording is retried.
      if (
        !job.uploaded &&
        (!job.upload || this.deps.now() - job.upload.mintedAt > UPLOAD_URL_MAX_AGE_MS)
      ) {
        this.patch(key, { status: "uploading", error: null, progress: 0 });
        const minted = await this.deps.prepareUploads({
          ...target,
          mediaTypes: [prepared.mediaType],
        });
        if (!minted.ok) throw new UploadFailed(minted.error);
        job.upload = { ...minted.data[0], mintedAt: this.deps.now() };
        this.patch(key, { attachmentId: job.upload.attachmentId });
      }
      const upload = job.upload!;

      if (!job.uploaded) {
        this.patch(key, { status: "uploading", error: null });
        let result: { error: StorageError | null };
        try {
          result = await this.deps.upload(upload, prepared.blob, (progress) =>
            this.patch(key, { progress }),
          );
        } catch {
          throw new UploadFailed(CONNECTION);
        }
        // Already there: an earlier attempt landed even if its answer was lost.
        if (result.error && !isAlreadyThere(result.error)) {
          throw uploadFailure(result.error, job);
        }
        job.uploaded = true;
      }

      this.patch(key, { status: "saving", progress: 1, error: null });
      const saved = await this.deps.recordPhoto({
        ...target,
        attachmentId: upload.attachmentId,
        path: upload.path,
        mediaType: upload.mediaType,
        byteSize: prepared.blob.size,
        width: prepared.width,
        height: prepared.height,
      });
      if (!saved.ok) {
        // Only a missing object means uploading again; anything else (the
        // server or session was down) retries the record step alone.
        if (saved.code === "attachment_object_missing") job.uploaded = false;
        throw new UploadFailed(saved.error);
      }
      // Saved: drop the photo data; the thumbnail stays until the page shows it.
      job.prepared = undefined;
      this.jobs.delete(key);
      this.patch(key, { status: "done", error: null });
      this.drained(it.targetKey);
    } catch (err) {
      const rejected =
        err instanceof PhotoRejected || (err instanceof UploadFailed && !err.retryable);
      const message =
        err instanceof PhotoRejected || err instanceof UploadFailed
          ? err.message
          : "Something went wrong. The photo is kept here; try again.";
      this.patch(key, { status: "failed", error: message, retryable: !rejected });
      if (rejected) {
        this.ui?.toast({ title: `${it.label} not saved`, description: message, tone: "error" });
      }
      this.notifyFailures(it.targetKey);
      this.drained(it.targetKey);
    } finally {
      job.running = false;
    }
  }

  /** One toast per record for the photos Retry can still save, updated in place. */
  private notifyFailures(targetKey: string) {
    const failed = this.items.filter(
      (it) => it.targetKey === targetKey && it.status === "failed" && it.retryable,
    );
    if (failed.length === 0) {
      this.ui?.dismissToast(failureToastKey(targetKey));
      return;
    }
    const n = failed.length;
    this.ui?.toast({
      key: failureToastKey(targetKey),
      title: n === 1 ? "1 photo not saved" : `${n} photos not saved`,
      description: failed[failed.length - 1].error ?? undefined,
      tone: "error",
      action: { label: n === 1 ? "Retry" : "Retry all", onAction: () => this.retryAll(targetKey) },
    });
  }

  /** When nothing is in flight for a record any more: refresh its page once, or say they saved. */
  private drained(targetKey: string) {
    const busy = this.items.some(
      (it) =>
        it.targetKey === targetKey &&
        (it.status === "preparing" || it.status === "uploading" || it.status === "saving"),
    );
    if (busy) return;
    const saved = this.items.filter((it) => it.targetKey === targetKey && it.status === "done");
    if (saved.length === 0) return;
    if (this.watchers.has(targetKey)) {
      this.ui?.refresh();
    } else {
      this.ui?.toast({
        key: savedToastKey(targetKey),
        title: saved.length === 1 ? "Photo saved" : `${saved.length} photos saved`,
        tone: "success",
      });
    }
  }
}
