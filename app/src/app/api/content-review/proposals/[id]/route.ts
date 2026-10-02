import { readAgentProposal, reviseAgentProposal } from "@/libs/contentReview/submit";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { agentProposalRevisionSchema } from "@/validators/contentReview";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

/** Read a suggestion's feedback, candidate rows and revision token for a refinement. */
export async function GET(request: Request, context: Context) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const { id } = await context.params;
  const proposal = await readAgentProposal(drizzleDB, id);
  if (!proposal)
    return Response.json({ error: "Suggestion not found" }, { status: 404 });
  return Response.json(proposal, { headers: { "Cache-Control": "no-store" } });
}

/** Full replacement of an agent suggestion; reactivation requires explicit intent. */
export async function PATCH(request: Request, context: Context) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON" }, { status: 400 });
  }
  const parsed = agentProposalRevisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid revision", issues: parsed.error.issues.slice(0, 20) },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  const result = await reviseAgentProposal(drizzleDB, id, parsed.data);
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
