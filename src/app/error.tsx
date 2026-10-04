"use client";

import { StatusScreen } from "@/components/shell/status-screen";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Unexpected errors below the root layout. Server errors arrive with only a
 * digest (no message, so nothing internal leaks); the same digest is logged
 * by instrumentation.ts onRequestError, so staff can quote it.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <StatusScreen
      code="500 · Error"
      title="Something went wrong"
      actions={
        <>
          <Button onClick={() => retry()}>Try again</Button>
          <ButtonLink href="/" variant="outline">
            Go to Today
          </ButtonLink>
        </>
      }
    >
      <p>
        Nothing was saved by the step that failed. Try again; if it keeps happening, tell an admin.
      </p>
      {error.digest ? (
        <p className="mt-3 text-sm text-dust-500">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
    </StatusScreen>
  );
}
