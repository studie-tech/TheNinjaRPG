/**
 * Call-endpoint broker — lets the TNR reviewer agent invoke tRPC endpoints
 * as a provisioned test user to set up game scenarios (raids, wars, etc.).
 *
 * Same security model as the main AI test-user broker:
 *  1. VERCEL_ENV === "preview" (or NODE_ENV === "development")
 *  2. A shared bearer token in the `x-tnr-reviewer-token` header
 */
import { TRPCError } from "@trpc/server";
import { NextResponse } from "next/server";
import { findUserIdentityById } from "@/queries/profile";

import { appRouter } from "@/server/api/root";
import { drizzleDB } from "@/server/db";
import { authenticateAiTestUserRequest } from "@/server/utils/aiTestUser";
import { aiTestUserCallEndpointRequestSchema } from "@/validators/ai-test-user";

export async function POST(request: Request) {
  const authError = authenticateAiTestUserRequest(
    request,
    "Call-endpoint broker is only available in preview",
  );
  if (authError) return authError;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = aiTestUserCallEndpointRequestSchema.safeParse(payload);
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

  const { userId, endpointName, input } = parsed.data;

  // Verify the user exists in the database
  const user = await findUserIdentityById(drizzleDB, userId);
  if (!user) {
    return NextResponse.json(
      { success: false, message: `User "${userId}" not found in database` },
      { status: 404 },
    );
  }

  // Create a tRPC caller impersonating the test user
  const caller = appRouter.createCaller({
    drizzle: drizzleDB,
    userIp: "ai-test-broker",
    userId,
    userAgent: "tnr-reviewer-broker",
    userCountry: undefined,
    abLemuReplacementVariant: undefined,
    wallpaperVariant: undefined,
  });

  // The caller is a recursive proxy that returns a callable for any key, so
  // walking it cannot tell a real procedure from internals like `_def` or
  // `toString`. Check the router's own procedure map, which is keyed by the
  // full dotted path, before resolving the callable off the caller.
  const procedures = appRouter._def.procedures as Record<string, unknown>;
  if (!Object.hasOwn(procedures, endpointName)) {
    return NextResponse.json(
      { success: false, message: `Invalid endpoint path: "${endpointName}"` },
      { status: 400 },
    );
  }

  let procedure: unknown = caller;
  for (const segment of endpointName.split(".")) {
    procedure = (procedure as Record<string, unknown>)[segment];
  }

  if (typeof procedure !== "function") {
    return NextResponse.json(
      {
        success: false,
        message: `Endpoint "${endpointName}" not found or not callable`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await (procedure as (input?: unknown) => Promise<unknown>)(
      input ?? undefined,
    );
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof TRPCError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Unknown error calling endpoint";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
