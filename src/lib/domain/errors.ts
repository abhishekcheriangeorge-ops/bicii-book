/**
 * A business rule the domain layer refused, with a message that is already
 * safe to show (ADR-001 A2). Server Actions turn it into
 * `{ ok: false, error, fieldErrors }` (src/lib/actions.ts); nothing else
 * about it reaches the client.
 *
 * Domain functions mirror the database's rules only to give a precise
 * message early; the RPCs remain the authority and check again.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
