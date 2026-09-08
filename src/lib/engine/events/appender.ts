import { appendRunEvents, type PendingRunEvent } from "@/lib/db/events";
import type { RunEvent } from "../types";

/**
 * The single serialised writer for a run's event log.
 *
 * Three things it has to get right:
 *
 * 1. **Ordering.** Sequence numbers are assigned synchronously at append time
 *    and writes are chained, so rows land in the order the engine produced
 *    them. SQLite takes one writer at a time anyway; making that explicit turns
 *    the limitation into the mechanism that guarantees a dense, monotonic seq.
 *
 * 2. **Not blocking the run.** `append` returns immediately. The engine never
 *    waits on the database between nodes, which would add a round-trip to
 *    every state change.
 *
 * 3. **Never breaking the run.** A write failure is reported and dropped.
 *    Persistence is best-effort here for the same reason it already is in the
 *    run route: losing history is bad, losing the run is worse.
 */

/**
 * `node:delta` is deliberately not persisted.
 *
 * A single model node can emit thousands of deltas, and every one of them is
 * already contained in the text that `node:success` carries. Writing them
 * would multiply the log by orders of magnitude to store a second copy of
 * information we already have. The cost is that a client reconnecting midway
 * through a node sees the node as running and then receives the whole output
 * at once, rather than watching the tail of the stream it missed.
 */
function isPersisted(event: RunEvent): boolean {
  return event.type !== "node:delta";
}

export interface RunEventSink {
  /** Records an event. Returns immediately; the write happens in the background. */
  append(event: RunEvent): void;
  /** Resolves once every appended event has been written or has failed. */
  flush(): Promise<void>;
  /** The sequence number most recently assigned. 0 before the first append. */
  readonly lastSeq: number;
}

export interface RunEventSinkOptions {
  /**
   * First sequence number to assign. Defaults to 1 for a new run; a run being
   * continued passes `lastRunEventSeq(runId) + 1` so numbering stays dense.
   *
   * Getting this wrong collides with an existing row, and the unique constraint
   * on (runId, seq) turns that into a loud failure rather than silent
   * corruption.
   */
  startSeq?: number;
  onError?: (error: unknown) => void;
}

export function createRunEventSink(runId: string, options: RunEventSinkOptions = {}): RunEventSink {
  const onError =
    options.onError ?? ((error: unknown) => console.error("Could not persist run events:", error));

  let nextSeq = options.startSeq ?? 1;
  let lastSeq = nextSeq - 1;
  let pending: PendingRunEvent[] = [];
  let scheduled = false;
  let tail: Promise<void> = Promise.resolve();

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    tail = tail.then(async () => {
      scheduled = false;
      const batch = pending;
      pending = [];
      if (batch.length === 0) return;
      try {
        await appendRunEvents(runId, batch);
      } catch (error) {
        onError(error);
      }
    });
  }

  return {
    append(event: RunEvent): void {
      if (!isPersisted(event)) return;
      lastSeq = nextSeq;
      pending.push({ seq: nextSeq++, event });
      schedule();
    },

    async flush(): Promise<void> {
      // Each awaited write can schedule the next link in the chain, so wait
      // until the chain stops growing rather than awaiting it once.
      let previous: Promise<void>;
      do {
        previous = tail;
        await previous;
      } while (previous !== tail);
    },

    get lastSeq(): number {
      return lastSeq;
    },
  };
}
