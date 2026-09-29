import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import {
  epidemicSfxDownloadUrl,
  isEpidemicConfigured,
} from "@/libs/contentReview/epidemic";
import { drizzleDB } from "@/server/db";
import { fetchWithTimeout } from "@/utils/http";
import { canChangeContent } from "@/utils/permissions";
import { sfxPreviewSchema } from "@/validators/contentReview";

export const dynamic = "force-dynamic";

/**
 * Streams an Epidemic Sound effect to the SFX picker's audio element, which needs a plain URL
 * rather than a tRPC call. Served from our own origin because the page's media-src only
 * admits our storage hosts, and the signed Epidemic link stays server-side.
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Sign in to preview sounds", { status: 401 });
  const parsed = sfxPreviewSchema.safeParse({
    epidemicId: new URL(request.url).searchParams.get("id"),
  });
  if (!parsed.success) return new Response("Missing sound id", { status: 400 });
  const user = await drizzleDB.query.userData.findFirst({
    columns: { role: true },
    where: eq(userData.userId, userId),
  });
  if (!user || !canChangeContent(user.role)) {
    return new Response("Only content staff can preview sounds", { status: 403 });
  }
  if (!isEpidemicConfigured()) {
    return new Response("Epidemic Sound is not configured", { status: 404 });
  }
  // The picker's audio element shows it cannot play; the reviewer can pick another sound.
  const failed = () =>
    new Response("Epidemic Sound did not return the sound", { status: 502 });
  try {
    const upstream = await fetchWithTimeout(
      await epidemicSfxDownloadUrl(parsed.data.epidemicId),
    );
    if (!upstream.ok || !upstream.body) return failed();
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (cause) {
    console.error("Epidemic Sound preview failed", cause);
    return failed();
  }
}
