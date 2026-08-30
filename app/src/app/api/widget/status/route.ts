import { and, eq, gte } from "drizzle-orm";
import { PUSH_TOKEN_STALE_DAYS } from "@/drizzle/constants";
import { userData, userDevice } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

/**
 * Status for the home screen widgets.
 *
 * Widgets normally render from the snapshot the app writes into its shared container,
 * which costs no network and no credential. This is the fallback for when the app has not
 * run in a while and that snapshot has gone stale.
 *
 * Authenticated with the device's own widget token rather than the Clerk session: a widget
 * runs outside the WebView and cannot see that session. The token is scoped to one device,
 * rotated on every registration, and grants nothing but that device's own status.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A device that stopped checking in is treated as gone, matching what the push fan-out
  // already does with the same window.
  const freshSince = secondsFromNow(-PUSH_TOKEN_STALE_DAYS * 24 * 60 * 60);
  const device = await drizzleDB.query.userDevice.findFirst({
    columns: { userId: true },
    where: and(
      eq(userDevice.widgetToken, token),
      gte(userDevice.lastSeenAt, freshSince),
    ),
  });
  if (!device) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await drizzleDB.query.userData.findFirst({
    columns: {
      username: true,
      avatar: true,
      rank: true,
      level: true,
      curHealth: true,
      maxHealth: true,
      curChakra: true,
      maxChakra: true,
      curStamina: true,
      maxStamina: true,
      unreadNotifications: true,
    },
    with: { village: { columns: { name: true } } },
    where: eq(userData.userId, device.userId),
  });
  if (!user) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Deliberately the same shape as WidgetSnapshot in libs/native/widgetBridge.ts, so the
  // widget decodes one type whichever source it came from.
  return Response.json(
    {
      updatedAt: new Date().toISOString(),
      username: user.username,
      avatar: user.avatar ?? undefined,
      village: user.village?.name,
      rank: user.rank,
      level: user.level,
      curHealth: Math.round(user.curHealth),
      maxHealth: Math.round(user.maxHealth),
      curChakra: Math.round(user.curChakra),
      maxChakra: Math.round(user.maxChakra),
      curStamina: Math.round(user.curStamina),
      maxStamina: Math.round(user.maxStamina),
      unreadNotifications: user.unreadNotifications,
    },
    // Private to one device, and stale within a minute anyway.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
