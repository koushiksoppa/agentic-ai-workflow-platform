import { z } from "zod";
import { NODE_KINDS } from "@/lib/types/workflow";

/**
 * Validation for a workflow arriving over HTTP. React Flow attaches its own
 * bookkeeping fields to nodes (selected, dragging, measured); Zod strips them,
 * so only the graph itself is stored or executed.
 */
export const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    kind: z.enum(NODE_KINDS),
    label: z.string(),
    config: z.record(z.string(), z.unknown()),
  }),
});

export const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
});

export const workflowDocumentSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().default("Untitled workflow"),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

export type ParsedWorkflowDocument = z.infer<typeof workflowDocumentSchema>;

/** Consistent 400 body across every route. */
export function badRequest(message: string, error?: unknown) {
  return Response.json(
    {
      error: message,
      detail: error instanceof z.ZodError ? z.treeifyError(error) : undefined,
    },
    { status: 400 },
  );
}
