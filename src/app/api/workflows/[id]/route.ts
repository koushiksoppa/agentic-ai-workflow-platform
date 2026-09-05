import { deleteWorkflow, getWorkflow, updateWorkflow } from "@/lib/db/workflows";
import { badRequest, workflowDocumentSchema } from "@/lib/api/schemas";
import type { WorkflowDocument } from "@/lib/types/workflow";

export const runtime = "nodejs";

/** Route params are async in the App Router. */
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const workflow = await getWorkflow(id);
  if (!workflow) return Response.json({ error: "Workflow not found." }, { status: 404 });
  return Response.json({ workflow });
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;

  let document: WorkflowDocument;
  try {
    document = workflowDocumentSchema.parse(await request.json()) as WorkflowDocument;
  } catch (error) {
    return badRequest("Invalid workflow.", error);
  }

  const updated = await updateWorkflow(id, document);
  if (!updated) return Response.json({ error: "Workflow not found." }, { status: 404 });
  return Response.json({ workflow: updated });
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const removed = await deleteWorkflow(id);
  if (!removed) return Response.json({ error: "Workflow not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
