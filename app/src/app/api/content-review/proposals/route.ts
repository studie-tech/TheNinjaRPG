import { ingestAgentSubmission } from "@/libs/contentReview/submit";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { agentSubmissionSchema } from "@/validators/contentReview";

export const dynamic = "force-dynamic";
// Sound searches copy files and generations wait on Replicate, both rationed per run.
export const maxDuration = 300;

/**
 * Suggestions from the daily content audit. Authenticated with the cron secret because the
 * caller is a scheduled CI job; it can only add suggestions, never approve them. Answers
 * with the suggestions accepted and the reason each other one was refused.
 */
export async function POST(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON" }, { status: 400 });
  }
  const parsed = agentSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid submission", issues: parsed.error.issues.slice(0, 20) },
      { status: 400 },
    );
  }
  const result = await ingestAgentSubmission(drizzleDB, parsed.data);
  return Response.json(result);
}
