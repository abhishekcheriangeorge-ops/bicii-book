import { signOut } from "@/app/(auth)/login/actions";
import { StatusScreen } from "@/components/shell/status-screen";
import { ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

/** 403: signed in, but not active staff or missing a permission (requireStaff). */
export default function Forbidden() {
  return (
    <StatusScreen
      code="403 · No access"
      title="You can't open this"
      actions={
        <>
          <ButtonLink href="/">Go to Today</ButtonLink>
          <form action={signOut}>
            <SubmitButton variant="outline" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </>
      }
    >
      <p>
        Your account doesn&apos;t have permission for this page. If you need it for your work, ask
        an admin to grant it under Settings → Staff. If your access was removed, sign out.
      </p>
    </StatusScreen>
  );
}
