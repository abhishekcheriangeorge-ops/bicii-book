"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  prepareUploads,
  recordPhoto,
  type Photo,
  type UploadTarget,
} from "@/app/(staff)/attachments/actions";
import { useToast } from "@/components/ui/toast";
import type { PhotoTarget } from "@/lib/attachments";
import { getBrowserClient } from "@/lib/supabase/browser";
import { onUploadProgress } from "@/lib/supabase/upload-progress";
import { newId } from "@/lib/uuid";

import { PhotoRejected, preparePhoto, type PreparedPhoto } from "./prepare-photo";

/**
 * The photo upload queue behind CaptureButton (ADR-001 A7). Each picked or
 * captured photo goes through:
 *
 *   preparing  decode, orient, downscale, re-encode (prepare-photo.ts)
 *   uploading  the server mints a signed upload URL for a new attachment
 *              id; the browser Supabase client uploads straight to Storage,
 *              reporting progress
 *   saving     the server records it (record_attachment checks the object)
 *   done       the page refreshes with the new photo
 *
 * Nothing is lost silently: a failure keeps the photo (in memory, with its
 * preview) and says so in an error toast with Retry, which resumes from the
 * failed step: an upload that actually landed is detected (Storage answers
 * "already exists") and not repeated, and recording is replay-safe. The
 * work outlives the component: navigating away mid-upload still finishes
 * (or fails with a toast, Retry included); closing the tab while photos are
 * unsaved asks first.
 */

export type UploadStatus = "preparing" | "uploading" | "saving" | "done" | "failed";

export type PendingUpload = {
  key: string;
  name: string;
  /** Object URL of the picked file, for the optimistic thumbnail. */
  previewUrl: string;
  status: UploadStatus;
  /** 0..1 while uploading. */
  progress: number;
  error: string | null;
  /** False when retrying cannot help (not a photo, too large). */
  retryable: boolean;
  attachmentId: string | null;
};

type Job = {
  file: File;
  prepared?: PreparedPhoto;
  upload?: UploadTarget & { mintedAt: number };
  uploaded: boolean;
  running: boolean;
};

/** Signed upload URLs last two hours; mint a new one well before that. */
const UPLOAD_URL_MAX_AGE_MS = 90 * 60 * 1000;
/** Photos processed at once (decode and upload); actions queue anyway. */
const CONCURRENCY = 2;

class UploadFailed extends Error {}

function isAlreadyThere(error: { message?: string; statusCode?: string; status?: number }) {
  return (
    error.statusCode === "409" ||
    error.status === 409 ||
    /already exists|duplicate/i.test(error.message ?? "")
  );
}

export function usePhotoUploads(target: PhotoTarget) {
  const { toast } = useToast();
  const [items, setItems] = useState<PendingUpload[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const mounted = useRef(true);
  const previews = useRef(new Map<string, string>());
  const targetRef = useRef(target);
  const toastRef = useRef(toast);
  const retryRef = useRef<(key: string) => void>(() => {});

  useEffect(() => {
    targetRef.current = target;
    toastRef.current = toast;
  });

  useEffect(() => {
    mounted.current = true;
    const urls = previews.current;
    return () => {
      mounted.current = false;
      // Unsaved jobs keep running (and keep their file) until they finish
      // or are retried from the toast; only the thumbnails go.
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const update = useCallback((key: string, patch: Partial<PendingUpload>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  const run = useCallback(
    async (key: string): Promise<void> => {
      const job = jobs.current.get(key);
      if (!job || job.running) return;
      job.running = true;
      const t = targetRef.current;
      try {
        if (!job.prepared) {
          update(key, { status: "preparing", error: null, progress: 0 });
          job.prepared = await preparePhoto(job.file);
        }
        const prepared = job.prepared;

        if (
          !job.upload ||
          (!job.uploaded && Date.now() - job.upload.mintedAt > UPLOAD_URL_MAX_AGE_MS)
        ) {
          update(key, { status: "uploading", error: null, progress: 0 });
          const minted = await prepareUploads({ ...t, mediaTypes: [prepared.mediaType] });
          if (!minted.ok) throw new UploadFailed(minted.error);
          job.upload = { ...minted.data[0], mintedAt: Date.now() };
          job.uploaded = false;
          update(key, { attachmentId: job.upload.attachmentId });
        }
        const upload = job.upload;

        if (!job.uploaded) {
          update(key, { status: "uploading", error: null });
          const stop = onUploadProgress(upload.token, (progress) => update(key, { progress }));
          try {
            const { error } = await getBrowserClient()
              .storage.from(upload.bucket)
              .uploadToSignedUrl(upload.path, upload.token, prepared.blob, {
                contentType: prepared.mediaType,
              });
            // Already there: an earlier attempt landed even if its answer was lost.
            if (error && !isAlreadyThere(error)) {
              throw new UploadFailed("The upload did not go through. Check the connection.");
            }
          } catch (err) {
            if (err instanceof UploadFailed) throw err;
            throw new UploadFailed("The upload did not go through. Check the connection.");
          } finally {
            stop();
          }
          job.uploaded = true;
        }

        update(key, { status: "saving", progress: 1, error: null });
        const saved = await recordPhoto({
          ...t,
          attachmentId: upload.attachmentId,
          path: upload.path,
          mediaType: upload.mediaType,
          byteSize: prepared.blob.size,
          width: prepared.width,
          height: prepared.height,
        });
        if (!saved.ok) {
          // Retry checks the upload again (cheap if it is there) before recording.
          job.uploaded = false;
          throw new UploadFailed(saved.error);
        }
        // Saved: drop the photo data; the thumbnail stays until the page shows it.
        job.prepared = undefined;
        jobs.current.delete(key);
        update(key, { status: "done", error: null });
        if (!mounted.current) toastRef.current({ title: "Photo saved", tone: "success" });
      } catch (err) {
        const rejected = err instanceof PhotoRejected;
        const message =
          err instanceof PhotoRejected || err instanceof UploadFailed
            ? err.message
            : "Something went wrong. The photo is kept here; try again.";
        update(key, { status: "failed", error: message, retryable: !rejected });
        toastRef.current({
          title: `${job.file.name || "Photo"} not saved`,
          description: message,
          tone: "error",
          action: rejected ? undefined : { label: "Retry", onAction: () => retryRef.current(key) },
        });
      } finally {
        job.running = false;
      }
    },
    [update],
  );

  const pump = useCallback(() => {
    const next = () => {
      while (active.current < CONCURRENCY && queue.current.length > 0) {
        const key = queue.current.shift()!;
        active.current++;
        void run(key).finally(() => {
          active.current--;
          next();
        });
      }
    };
    next();
  }, [run]);

  const retry = useCallback(
    (key: string) => {
      const job = jobs.current.get(key);
      if (!job || job.running || queue.current.includes(key)) return;
      update(key, { status: job.prepared ? "uploading" : "preparing", error: null });
      queue.current.push(key);
      pump();
    },
    [pump, update],
  );

  useEffect(() => {
    retryRef.current = retry;
  });

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const added: PendingUpload[] = files.map((file) => {
        const key = newId();
        const previewUrl = URL.createObjectURL(file);
        jobs.current.set(key, { file, uploaded: false, running: false });
        previews.current.set(key, previewUrl);
        queue.current.push(key);
        return {
          key,
          name: file.name,
          previewUrl,
          status: "preparing",
          progress: 0,
          error: null,
          retryable: true,
          attachmentId: null,
        };
      });
      setItems((list) => [...list, ...added]);
      pump();
    },
    [pump],
  );

  /** Forget a failed photo (staff chose to). */
  const discard = useCallback((key: string) => {
    const job = jobs.current.get(key);
    if (job?.running) return;
    jobs.current.delete(key);
    queue.current = queue.current.filter((k) => k !== key);
    const url = previews.current.get(key);
    previews.current.delete(key);
    setItems((list) => list.filter((it) => it.key !== key));
    if (url) URL.revokeObjectURL(url);
  }, []);

  // Closing or reloading the tab with unsaved photos asks first.
  const unsaved = items.some((it) => it.status !== "done");
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  return { items, addFiles, retry, discard };
}

export type { Photo };
