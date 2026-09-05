/**
 * Limits shared between the HTTP node's executor and its editor definition.
 *
 * These live apart from the executor because `definitions.ts` is imported by
 * client components, and the executor imports Node built-ins (dns, net) for
 * its address checks. Importing the executor from there would drag those into
 * the browser bundle and break the build.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 120_000;

/** Caps how much of a response is pulled into memory and into the run record. */
export const MAX_RESPONSE_BYTES = 1_000_000;
