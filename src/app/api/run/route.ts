import { z } from "zod";
import { executeWorkflow } from "@/lib/engine/execute";
import type { RunStatus } from "@/lib/engine/types";
import { createRun, finishRun, recordStep } from "@/lib/db/runs";
import { workflowDocumentSchema } from "@/lib/api/schemas";
import type { WorkflowDocument } from "@/lib/types/workflow";

/** The engine uses fetch, timers, and crypto — it needs the Node runtime. */
export const runtime = "nodejs";

/**
 * Saved workflows with a run in flight.
 *
 * The Run button is disabled while a run is going, but that only guards one
 * tab. This stops the same saved workflow being executed twice concurrently,
 * which would interleave two sets of step rows and bill two sets of model
 * calls. Unsaved drafts have no id and are not tracked.
 *
 * Process-local, which matches the single-process SQLite deployment. A
 * multi-instance deployment would need this in the database.
 */
const runningWorkflows = new Set<string>();

const requestSchema = z.object({
  workflow: workflowDocumentSchema,
  inputs: z.record(z.string(), z.string()).optional(),
  /** Links the run to a saved workflow, when the canvas has one open. */
  workflowId: z.string().nullish(),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof requestSchema>;

  try {
    parsed = requestSchema.parse(await request.json());
  } catch (error) {
    return Response.json(
      {
        error: "Invalid run request.",
        detail: error instanceof z.ZodError ? z.treeifyError(error) : String(error),
      },
      { status: 400 },
    );
  }

  const document = parsed.workflow as unknown as WorkflowDocument;
  const kindOf = new Map(document.nodes.map((n) => [n.id, n.data.kind]));

  const lockId = parsed.workflowId ?? null;
  if (lockId) {
    if (runningWorkflows.has(lockId)) {
      return Response.json(
        { error: "This workflow is already running. Wait for it to finish, or cancel it." },
        { status: 409 },
      );
    }
    runningWorkflows.add(lockId);
  }

  // Persistence is best-effort: a database problem must not stop the run.
  let runId: string | undefined;
  try {
    runId = await createRun({
      workflowId: parsed.workflowId ?? null,
      workflowName: document.name,
      document,
    });
  } catch (error) {
    console.error("Could not open a run record:", error);
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let position = 0;
  // node:start carries the input; the step row is only written on completion.
  const inputs = new Map<string, unknown>();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Once the client disconnects, enqueueing throws. Swallowing that here
      // keeps a dead stream from hijacking control flow and skipping the
      // persistence below, which previously left runs stuck at "running".
      let clientGone = false;
      const send = (event: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}

`));
        } catch {
          clientGone = true;
        }
      };

      // Every terminal status goes through here, and it runs at most once, so
      // the run record always reaches a final state exactly one time.
      let closed = false;
      const closeRun = async (
        status: RunStatus,
        error: string | null,
        durationMs: number,
      ) => {
        if (!runId || closed) return;
        closed = true;
        try {
          await finishRun(runId, { status, error, durationMs });
        } catch (dbError) {
          console.error("Could not close the run record:", dbError);
        }
      };

      try {
        for await (const event of executeWorkflow(document, {
          inputs: parsed.inputs,
          runId,
          // Aborts the run if the client disconnects mid-stream.
          signal: request.signal,
        })) {
          send(event);

          if (event.type === "node:start") inputs.set(event.nodeId, event.input);

          if (!runId) continue;

          try {
            switch (event.type) {
              case "node:success":
              case "node:error":
              case "node:skipped":
                await recordStep(runId, {
                  nodeId: event.nodeId,
                  nodeKind: kindOf.get(event.nodeId) ?? "unknown",
                  position: position++,
                  status: event.type.slice("node:".length),
                  input: inputs.get(event.nodeId),
                  output: event.type === "node:success" ? event.output : undefined,
                  metadata:
                    event.type === "node:success"
                      ? (event.metadata ?? null)
                      : event.type === "node:skipped"
                        ? { skipReason: event.reason }
                        : null,
                  error: event.type === "node:error" ? event.error : null,
                  durationMs: "durationMs" in event ? event.durationMs : null,
                });
                break;
              case "run:finish":
                await closeRun(event.status, event.error ?? null, event.durationMs);
                break;
            }
          } catch (error) {
            console.error("Could not persist run event:", error);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send({
          type: "run:finish",
          status: "error",
          durationMs: Date.now() - startedAt,
          outputs: {},
          error: message,
        });
        await closeRun("error", message, Date.now() - startedAt);
      } finally {
        if (lockId) runningWorkflows.delete(lockId);

        // Backstop: if the generator was abandoned before emitting a terminal
        // event — a disconnect being the usual cause — the run would otherwise
        // stay "running" forever.
        await closeRun(
          "cancelled",
          "The client disconnected before the run finished.",
          Date.now() - startedAt,
        );
        try {
          controller.close();
        } catch {
          // Already closed or errored by the disconnect; nothing to do.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops proxies (and Next's dev overlay) from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
