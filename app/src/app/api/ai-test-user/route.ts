/**
 * AI test-user broker — preview-only API for the TNR reviewer agent.
 *
 * Lets the Codex-based reviewer provision throwaway Clerk + DB users on the
 * Vercel preview deployment so it can log in and exercise the app in CI.
 * Guarded by:
 *  1. VERCEL_ENV === "preview" (or NODE_ENV === "development")
 *  2. A shared bearer token in the `x-tnr-reviewer-token` header
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { provisionAiTestUsers } from "@/libs/testing/ai-test-users";
import {
  aiTestUserRequestSchema,
  aiTestUserResponseSchema,
} from "@/validators/ai-test-user";

const PREVIEW_ENV_VALUE = "preview";
const MACHINE_TOKEN_HEADER = "x-tnr-reviewer-token";

// Prevent Vercel from caching this endpoint — every call mutates external state
export const dynamic = "force-dynamic";

/** Extract the machine-to-machine auth token from the request headers. */
const getMachineToken = async () => {
  const requestHeaders = await headers();
  return requestHeaders.get(MACHINE_TOKEN_HEADER);
};

/** Only allow calls on Vercel preview deployments or local dev. */
const isPreviewDeployment = () =>
  process.env.VERCEL_ENV === PREVIEW_ENV_VALUE ||
  process.env.NODE_ENV === "development";

export async function POST(request: Request) {
  // ── Guard 1: environment ──
  if (!isPreviewDeployment()) {
    return NextResponse.json(
      { success: false, message: "AI test-user broker is only available in preview" },
      { status: 403 },
    );
  }

  // ── Guard 2: server-side token configured ──
  const expectedToken = process.env.AI_TEST_USER_BROKER_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { success: false, message: "AI test-user broker token is not configured" },
      { status: 500 },
    );
  }

  // ── Guard 3: caller provides matching token ──
  const providedToken = await getMachineToken();
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

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
      testingToken: provisioned.testingToken,
      version: provisioned.version,
    });
    return NextResponse.json(responsePayload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to provision users";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
