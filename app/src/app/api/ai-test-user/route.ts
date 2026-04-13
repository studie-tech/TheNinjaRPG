import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { provisionAiTestUsers } from "@/libs/testing/ai-test-users";
import {
  aiTestUserRequestSchema,
  aiTestUserResponseSchema,
} from "@/validators/ai-test-user";

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
      { success: false, message: "AI test-user broker is only available in preview" },
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

  const runId = parsed.data.runId ?? `preview-${Date.now()}`;

  try {
    const provisioned = await provisionAiTestUsers(parsed.data.users, runId);
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
