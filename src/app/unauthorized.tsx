import { StatusScreen } from "@/components/shell/status-screen";
import { ButtonLink } from "@/components/ui/button";

/** 401: unauthorized() was called because nobody is signed in. */
export default function Unauthorized() {
  return (
    <StatusScreen
      code="401 · Signed out"
      title="Sign in to continue"
      actions={<ButtonLink href="/login">Sign in</ButtonLink>}
    >
      <p>Your session has ended. Sign in again to pick up where you left off.</p>
    </StatusScreen>
  );
}
