/**
 * Execution limits shared between node executors and their editor definitions.
 *
 * These live apart from the executors because `definitions.ts` is imported by
 * client components while the executors import Node built-ins (dns, net).
 * Importing an executor from there drags those into the browser bundle and
 * fails the build.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 120_000;

/** Caps how much of an HTTP response is read into memory and into a run record. */
export const MAX_RESPONSE_BYTES = 1_000_000;

export const DEFAULT_RETRIES = 0;
export const MAX_RETRIES = 5;

/** Base delay for exponential backoff between attempts. */
export const RETRY_BASE_DELAY_MS = 500;
export const MAX_RETRY_DELAY_MS = 10_000;

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function resolveTimeout(value: unknown): number {
  return clampNumber(value, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

export function resolveRetries(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_RETRIES;
  return clampNumber(value, 0, MAX_RETRIES, DEFAULT_RETRIES);
}

/** Exponential backoff, capped. Attempt is 1-based. */
export function retryDelay(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
}
