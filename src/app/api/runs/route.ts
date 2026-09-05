import { listRuns } from "@/lib/db/runs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId") ?? undefined;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  return Response.json({ runs: await listRuns({ workflowId, limit }) });
}
