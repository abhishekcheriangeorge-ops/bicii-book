/**
 * The devstack mail client (scripts/devstack/mail-client.mjs) for specs.
 * Playwright compiles specs to CommonJS, which cannot `import` an ES module
 * statically, so this loads it with a dynamic import() on first use.
 */
type MailClient = typeof import("../../scripts/devstack/mail-client.mjs");
type WaitOptions = Parameters<MailClient["waitForMessage"]>[0];

let client: Promise<MailClient> | undefined;
const load = () => (client ??= import("../../scripts/devstack/mail-client.mjs"));

/** An opaque cursor for the newest message to `to` (null: none yet). Take it before asking for a code. */
export async function mailCursor(to: string): Promise<string | null> {
  return (await load()).mailCursor(to);
}

/** The newest message to `to` after the cursor; throws if none arrives in time. */
export async function waitForMessage(options: WaitOptions) {
  return (await load()).waitForMessage(options);
}

/** The sign-in code in the newest message to `to` after the cursor. */
export async function waitForCode(options: WaitOptions): Promise<string> {
  return (await load()).waitForCode(options);
}
