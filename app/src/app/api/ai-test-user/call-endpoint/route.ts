/**
 * Call-endpoint broker — lets the TNR reviewer agent invoke tRPC endpoints
 * as a provisioned test user to set up game scenarios (raids, wars, etc.).
 *
 * Same security model as the main AI test-user broker:
 *  1. VERCEL_ENV === "preview" (or NODE_ENV === "development")
 *  2. A shared bearer token in the `x-tnr-reviewer-token` header
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { userData } from "@/drizzle/schema";
import { appRouter } from "@/server/api/root";
import { drizzleDB } from "@/server/db";
import { aiTestUserCallEndpointRequestSchema } from "@/validators/ai-test-user";

const PREVIEW_ENV_VALUE = "preview";
const MACHINE_TOKEN_HEADER = "x-tnr-reviewer-token";

export const dynamic = "force-dynamic";

const getMachineToken = async () => {
  const requestHeaders = await headers();
  return requestHeaders.get(MACHINE_TOKEN_HEADER);
};

const isPreviewDeployment = () =>
  process.env.VERCEL_ENV === PREVIEW_ENV_VALUE ||
  process.env.NODE_ENV === "development";

export async function POST(request: Request) {
  if (!isPreviewDeployment()) {
    return NextResponse.json(
      { success: false, message: "Call-endpoint broker is only available in preview" },
      { status: 403 },
    );
  }

  const expectedToken = process.env.AI_TEST_USER_BROKER_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { success: false, message: "AI test-user broker token is not configured" },
      { status: 500 },
    );
  }

  const providedToken = await getMachineToken();
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

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
  const user = await drizzleDB.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true },
  });
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
    abLemuReplacementVariant: undefined,
    abPixelLayoutVariant: undefined,
  });

  // Resolve the procedure by traversing the caller object
  const pathSegments = endpointName.split(".");
  let procedure: unknown = caller;
  for (const segment of pathSegments) {
    if (
      procedure === null ||
      procedure === undefined ||
      typeof procedure !== "object"
    ) {
      return NextResponse.json(
        { success: false, message: `Invalid endpoint path: "${endpointName}"` },
        { status: 400 },
      );
    }
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
