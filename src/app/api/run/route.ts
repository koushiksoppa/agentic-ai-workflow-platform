import { z } from "zod";
import { executeWorkflow } from "@/lib/engine/execute";
import { createRun, finishRun, recordStep } from "@/lib/db/runs";
import { workflowDocumentSchema } from "@/lib/api/schemas";
import type { WorkflowDocument } from "@/lib/types/workflow";

/** The engine uses fetch, timers, and crypto — it needs the Node runtime. */
export const runtime = "nodejs";

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
  let position = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        for await (const event of executeWorkflow(document, {
          inputs: parsed.inputs,
          runId,
          // Aborts the run if the client disconnects mid-stream.
          signal: request.signal,
        })) {
          send(event);

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
                  output: event.type === "node:success" ? event.output : undefined,
                  error: event.type === "node:error" ? event.error : null,
                  durationMs: "durationMs" in event ? event.durationMs : null,
                });
                break;
              case "run:finish":
                await finishRun(runId, {
                  status: event.status,
                  error: event.error ?? null,
                  durationMs: event.durationMs,
                });
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
          durationMs: 0,
          outputs: {},
          error: message,
        });
        if (runId) {
          try {
            await finishRun(runId, { status: "error", error: message, durationMs: 0 });
          } catch {
            // Already reported to the client; nothing further to do.
          }
        }
      } finally {
        controller.close();
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
