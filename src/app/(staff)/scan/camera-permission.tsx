"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CameraIcon } from "@/components/ui/icons";

type CameraState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

const MESSAGES: Record<CameraState, string> = {
  unknown: "Checking camera access…",
  prompt: "Allow camera access so scanning works the moment it arrives.",
  granted: "Camera access is allowed.",
  denied:
    "Camera access is blocked. On iPhone: Settings → Safari → Camera → Allow, then reload this page.",
  unsupported:
    "This browser cannot use the camera here. Open the app over HTTPS in Safari or Chrome.",
};

/**
 * Asks for camera permission ahead of time and shows its state. The
 * scanner itself (BarcodeDetector with a ZXing fallback, PLAN §5) arrives in
 * Phase 4; nothing is captured or uploaded here.
 */
export function CameraPermission() {
  const [state, setState] = useState<CameraState>("unknown");

  useEffect(() => {
    let cancelled = false;
    const update = (next: CameraState) => {
      if (!cancelled) setState(next);
    };
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return update("unsupported");
      try {
        const status = await navigator.permissions.query({ name: "camera" as PermissionName });
        update(status.state as CameraState);
        status.onchange = () => update(status.state as CameraState);
      } catch {
        // Safari before 16 and Firefox cannot query camera permission.
        update("prompt");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      for (const track of stream.getTracks()) track.stop();
      setState("granted");
    } catch {
      setState("denied");
    }
  }

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <span
          aria-hidden="true"
          className="flex size-20 items-center justify-center rounded-full bg-yellow text-ink"
        >
          <CameraIcon className="size-9" />
        </span>
        <p role="status" className="measure text-dust-700">
          {MESSAGES[state]}
        </p>
        {state === "prompt" ? (
          <Button variant="solid" onClick={requestAccess}>
            Allow camera
          </Button>
        ) : null}
        <p className="text-sm text-dust-500">Scanning QR labels arrives in Phase 4 (Inventory).</p>
      </div>
    </Card>
  );
}
