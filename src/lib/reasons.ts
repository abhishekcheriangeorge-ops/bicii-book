/**
 * Reasons for audited changes (SPEC §22: destructive actions require a
 * reason). The database refuses longer ones (reason_too_long, and the
 * reason checks on the event tables). Pure, so forms can cap the field.
 */
export const REASON_MAX_LENGTH = 500;
