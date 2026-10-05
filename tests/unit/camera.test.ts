import { describe, expect, it } from "vitest";

import { CAMERA_MESSAGES, cameraErrorState } from "@/components/domain/camera-permission";

const err = (name: string) => new DOMException("x", name);

describe("cameraErrorState", () => {
  it("maps getUserMedia failures onto the scanner's camera messages", () => {
    expect(cameraErrorState(err("NotAllowedError"))).toBe("denied");
    expect(cameraErrorState(err("SecurityError"))).toBe("insecure");
    expect(cameraErrorState(err("NotFoundError"))).toBe("unsupported");
    expect(cameraErrorState(err("OverconstrainedError"))).toBe("unsupported");
    expect(cameraErrorState(err("NotReadableError"))).toBe("failed");
    expect(cameraErrorState("weird")).toBe("failed");
  });

  it("keeps Phase 0's permission messages", () => {
    expect(CAMERA_MESSAGES.denied).toContain("Settings → Safari → Camera → Allow");
    expect(CAMERA_MESSAGES.unsupported).toContain("HTTPS");
    expect(CAMERA_MESSAGES.insecure).toContain("HTTPS");
  });
});
