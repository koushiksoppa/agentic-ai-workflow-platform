import { getRun } from "@/lib/db/runs";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
  return Response.json({ run });
}
