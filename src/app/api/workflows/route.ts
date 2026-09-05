import { createWorkflow, listWorkflows } from "@/lib/db/workflows";
import { badRequest, workflowDocumentSchema } from "@/lib/api/schemas";
import type { WorkflowDocument } from "@/lib/types/workflow";
export const runtime = "nodejs";
export async function GET() {
  return Response.json({ workflows: await listWorkflows() });
}
export async function POST(request: Request) {
  let document: WorkflowDocument;
  try {
    document = workflowDocumentSchema.parse(await request.json()) as WorkflowDocument;
  } catch (error) {
    return badRequest("Invalid workflow.", error);
  }
  const saved = await createWorkflow(document);
  return Response.json({ workflow: saved }, { status: 201 });
}
