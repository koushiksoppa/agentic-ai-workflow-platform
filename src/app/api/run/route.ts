import { z } from "zod";
import { executeWorkflow } from "@/lib/engine/execute";
import { NODE_KINDS } from "@/lib/types/workflow";
import type { WorkflowDocument } from "@/lib/types/workflow";

/** The engine uses fetch, timers, and crypto — it needs the Node runtime. */
export const runtime = "nodejs";

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    kind: z.enum(NODE_KINDS),
    label: z.string(),
    config: z.record(z.string(), z.unknown()),
  }),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
});

const requestSchema = z.object({
  workflow: z.object({
    version: z.literal(1).default(1),
    name: z.string().default("Untitled workflow"),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
  }),
  inputs: z.record(z.string(), z.string()).optional(),
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

  const encoder = new TextEncoder();
  const document = parsed.workflow as unknown as WorkflowDocument;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of executeWorkflow(document, {
          inputs: parsed.inputs,
          // Aborts the run if the client disconnects mid-stream.
          signal: request.signal,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "run:finish",
              status: "error",
              durationMs: 0,
              outputs: {},
              error: message,
            })}\n\n`,
          ),
        );
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
