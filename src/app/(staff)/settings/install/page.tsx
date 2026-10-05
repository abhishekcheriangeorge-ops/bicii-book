import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Install the app" };

/**
 * iOS Safari has no install prompt (no beforeinstallprompt), so staff need
 * the steps (PLAN §5 "iOS camera and PWA quirks").
 */
export default async function InstallPage() {
  await requireStaff();
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Install the app"
        description="BICII Admin runs full screen from your home screen, like a native app. It still needs a connection: stock and money changes are never saved offline."
      />
      <Card title="iPhone and iPad (Safari)">
        <ol className="flex list-decimal flex-col gap-3 pl-5 marker:font-display marker:font-bold">
          <li>
            Open this site in Safari (other iOS browsers can also add it from their Share menu).
          </li>
          <li>
            Tap the <strong>Share</strong> button: the square with an arrow, at the bottom of the
            screen on iPhone or the top on iPad.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>. If you don&apos;t see it, tap{" "}
            <strong>Edit Actions</strong> and add it.
          </li>
          <li>
            Keep the name <strong>BICII</strong> and turn on <strong>Open as Web App</strong> if
            shown, then tap <strong>Add</strong>.
          </li>
          <li>Open BICII from the home screen and sign in once.</li>
        </ol>
      </Card>
      <Card title="Android (Chrome)">
        <ol className="flex list-decimal flex-col gap-3 pl-5 marker:font-display marker:font-bold">
          <li>Open the menu (⋮) in Chrome.</li>
          <li>
            Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>) and confirm.
          </li>
        </ol>
      </Card>
      <Card title="Camera access">
        <p className="text-dust-700">
          Scanning and photos use the camera. If you once denied access, on iPhone go to Settings →
          Safari → Camera and choose Allow, then reopen the app.
        </p>
      </Card>
    </>
  );
}
