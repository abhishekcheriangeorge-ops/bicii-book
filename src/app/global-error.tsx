"use client";

import "./globals.css";

/**
 * Errors in the root layout itself. Replaces the whole document, so it
 * brings its own <html>/<body> and imports the global styles (system fonts:
 * next/font from the root layout is not available here).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en-SG">
      <body className="flex min-h-dvh flex-col bg-paper text-ink">
        <title>Something went wrong · BICII Admin</title>
        <main className="gutter flex flex-1 flex-col justify-center gap-6 py-12">
          <p className="eyebrow text-dust-500">500 · Error</p>
          <h1 className="text-5xl">Something went wrong</h1>
          <p className="measure text-dust-700">
            BICII Admin could not load. Try again; if it keeps happening, tell an admin.
          </p>
          {error.digest ? (
            <p className="text-sm text-dust-500">
              Reference: <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
          <div>
            <button
              type="button"
              onClick={() => retry()}
              className="min-h-12 rounded-full bg-ink px-6 font-bold tracking-wide text-paper uppercase"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
