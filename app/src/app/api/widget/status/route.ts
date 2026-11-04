import { findUserDeviceForGET } from "@/queries/push";
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

  // The profile comes back with the device rather than in a second hop: a widget refreshes
  // on the system's timeline budget for every install that has one, so this is the most
  // frequently hit new endpoint in the app. Drizzle emits this as a single statement with
  // a lateral join, not as two queries.
  const device = await findUserDeviceForGET(drizzleDB, token);
  // Kept apart: an unknown or stale token is not authorised, whereas a device whose
  // account has since gone is a device pointing at nothing.
  if (!device) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = device.user;
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
