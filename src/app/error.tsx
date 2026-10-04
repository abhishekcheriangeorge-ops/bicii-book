"use client";

import { StatusScreen } from "@/components/shell/status-screen";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Unexpected errors below the root layout. Server errors arrive with only a
 * digest (no message, so nothing internal leaks); the same digest is logged
 * by instrumentation.ts onRequestError, so staff can quote it.
 *
 * This boundary cannot know whether anything was saved: it also catches the
 * re-render AFTER a Server Action committed (refresh()), so the copy makes
 * no claim about persistence and tells staff to check before repeating a
 * change (a repeated stock, payment or settlement commit is the risk).
 * "Reload this page" only re-renders the segment; it never resubmits an action.
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
          <Button onClick={() => retry()}>Reload this page</Button>
          <ButtonLink href="/" variant="outline">
            Go to Today
          </ButtonLink>
        </>
      }
    >
      <p>
        This page could not be shown. If you had just saved a change, it may or may not have gone
        through: check the record before you repeat it. If this keeps happening, tell an admin.
      </p>
      {error.digest ? (
        <p className="mt-3 text-sm text-dust-500">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
    </StatusScreen>
  );
}
