import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { accountDeletion } from "@/drizzle/schema";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { drizzleDB } from "@/server/db";
import { prepareAppleDeletion } from "@/server/utils/accountDeletion/apple";
import {
  ACCOUNT_DELETION_REVERIFICATION,
  accountDeletionSchema,
} from "@/validators/accountDeletion";

export async function POST(request: Request) {
  // A shell marker selects the supported UI; it is spoofable and is NOT authentication.
  if (!isNativeUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json(
      { message: "Use the native app to request account deletion." },
      { status: 403 },
    );
  }
  const session = await auth();
  if (!session.userId)
    return NextResponse.json(
      { message: "Sign in again to continue." },
      { status: 401 },
    );
  if (!session.has({ reverification: ACCOUNT_DELETION_REVERIFICATION })) {
    return reverificationErrorResponse(ACCOUNT_DELETION_REVERIFICATION);
  }
  const input = accountDeletionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.expectedUserId !== session.userId)
    return NextResponse.json(
      { message: "Complete both acknowledgements and type DELETE MY ACCOUNT." },
      { status: 400 },
    );
  // Do not accept irreversible requests if the authenticated cleanup worker is disabled.
  if (
    !process.env.CRON_SECRET ||
    process.env.NATIVE_ACCOUNT_DELETION_ENABLED !== "true"
  )
    return NextResponse.json(
      {
        message: "Account deletion is temporarily unavailable. Please try again later.",
      },
      { status: 503 },
    );
  try {
    const existing = await drizzleDB.query.accountDeletion.findFirst({
      columns: { userId: true },
      where: eq(accountDeletion.userId, session.userId),
    });
    if (existing)
      return NextResponse.json(
        { success: true, message: "Your deletion request is already saved." },
        { status: 202 },
      );
    const appleRevokedSubject = await prepareAppleDeletion(
      session.userId,
      input.data.appleAuthorizationCode,
    );
    // The authenticated identity is the only target. Duplicate clicks and lost responses
    // cannot enqueue a second deletion or reset a partially processed request.
    await drizzleDB
      .insert(accountDeletion)
      .values({ userId: session.userId, appleRevokedSubject })
      .onDuplicateKeyUpdate({ set: { userId: session.userId } });
    return NextResponse.json(
      {
        success: true,
        message:
          "Your permanent account deletion request has been accepted. You will be signed out. Cleanup runs in the background.",
      },
      { status: 202 },
    );
  } catch {
    return NextResponse.json(
      {
        message:
          "We could not save your request. Nothing has been confirmed; please try again.",
      },
      { status: 503 },
    );
  }
}
