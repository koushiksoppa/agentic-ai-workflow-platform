import type { RunEvent } from "@/lib/engine/types";
import { prisma } from "./client";

/**
 * Persistence for the append-only run event log.
 *
 * Rows are written once and never updated. The `type` and `nodeId` columns
 * duplicate fields that also live inside `payload`: the columns exist so the
 * log can be filtered without parsing every row, while the payload stays a
 * faithful copy of exactly what the engine emitted. Readers should trust the
 * payload.
 */

/** One row, as stored. `payload` is still JSON text at this boundary. */
export interface StoredRunEvent {
  seq: number;
  type: string;
  nodeId: string | null;
  payload: string;
}

/** An event ready to be written, with its sequence number already assigned. */
export interface PendingRunEvent {
  seq: number;
  event: RunEvent;
}

export async function appendRunEvents(
  runId: string,
  pending: readonly PendingRunEvent[],
): Promise<void> {
  if (pending.length === 0) return;

  await prisma.runEvent.createMany({
    data: pending.map(({ seq, event }) => ({
      runId,
      seq,
      type: event.type,
      nodeId: "nodeId" in event ? event.nodeId : null,
      payload: JSON.stringify(event),
    })),
  });
}

/**
 * Events for a run in sequence order.
 *
 * `afterSeq` is the cursor: pass the last sequence number already seen and
 * receive only what came after it. That is what makes a reconnecting client
 * cheap to serve and a replay resumable from the middle.
 */
export async function listRunEvents(
  runId: string,
  options: { afterSeq?: number; limit?: number } = {},
): Promise<StoredRunEvent[]> {
  const rows = await prisma.runEvent.findMany({
    where: {
      runId,
      ...(options.afterSeq !== undefined ? { seq: { gt: options.afterSeq } } : {}),
    },
    orderBy: { seq: "asc" },
    ...(options.limit !== undefined ? { take: options.limit } : {}),
    select: { seq: true, type: true, nodeId: true, payload: true },
  });
  return rows;
}

/**
 * The highest sequence number written for a run, or 0 if it has no events.
 *
 * Used to seed a writer that is continuing an existing run rather than
 * starting one, so sequence numbers stay dense across a resume.
 */
export async function lastRunEventSeq(runId: string): Promise<number> {
  const row = await prisma.runEvent.findFirst({
    where: { runId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return row?.seq ?? 0;
}

/** Parses stored rows back into engine events, dropping any that are corrupt. */
export function parseRunEvents(rows: readonly StoredRunEvent[]): RunEvent[] {
  const events: RunEvent[] = [];
  for (const row of rows) {
    try {
      events.push(JSON.parse(row.payload) as RunEvent);
    } catch {
      // A row we cannot parse is a row we cannot trust. Skipping it keeps the
      // rest of the run readable, which matters more than failing loudly on
      // history that is already written and cannot be corrected.
    }
  }
  return events;
}
