/**
 * AI test-user broker for automated reviewers and local agents.
 *
 * Provisions throwaway Clerk + DB users on preview deployments and local
 * development servers, so the CI reviewer and `make dev-user` callers can log in
 * and exercise the app.
 * Guarded by:
 *  1. VERCEL_ENV === "preview" (or NODE_ENV === "development")
 *  2. A shared bearer token in the `x-tnr-reviewer-token` header
 */
import { NextResponse } from "next/server";
import { provisionAiTestUsers } from "@/libs/testing/ai-test-users";
import { authenticateAiTestUserRequest } from "@/server/utils/aiTestUser";
import {
  aiTestUserRequestSchema,
  aiTestUserResponseSchema,
} from "@/validators/ai-test-user";

export async function POST(request: Request) {
  const authError = authenticateAiTestUserRequest(request);
  if (authError) return authError;

  // ── Parse and validate the request body ──
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = aiTestUserRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid request payload",
        errors: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  // Default runId ties provisioned users to this specific invocation
  const runId = parsed.data.runId ?? `preview-${Date.now()}`;

  // ── Provision users in Clerk + DB, return credentials ──
  try {
    const provisioned = await provisionAiTestUsers(parsed.data.users, runId);
    // Validate our own response shape before sending — catches drift early
    const responsePayload = aiTestUserResponseSchema.parse({
      success: true,
      users: provisioned.users,
    });
    return NextResponse.json(responsePayload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to provision users";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
