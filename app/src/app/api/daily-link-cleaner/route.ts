import { eq, like, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { forumPost, userNindo } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { isFetchOriginError } from "@/utils/error";
import { isUrlAccessible, isWithinImgTag } from "@/utils/url";

const ENDPOINT_NAME = "daily-link-cleaner";

interface UrlCheckResult {
  url: string;
  keep: boolean;
  isImg: boolean;
  fullTag?: string;
}

function processContentUrls<T extends { id: string; content: string }>(
  items: T[],
  table: typeof userNindo | typeof forumPost,
  urlRegex: RegExp,
) {
  return Promise.all(
    items.map(async (item) => {
      // Extract all URLs from the content
      const urls = [...item.content.matchAll(urlRegex)].map((match) => match[0]);

      // Check all URLs in parallel
      const urlChecks = await Promise.all(
        urls.map(async (url) => {
          const isAccessible = await isUrlAccessible(url);
          const imgCheck = isWithinImgTag(item.content, url);
          return { url, keep: isAccessible, ...imgCheck } as UrlCheckResult;
        }),
      );

      // Replace inaccessible URLs
      let newContent = item.content;
      urlChecks.forEach(({ url, keep, isImg, fullTag }) => {
        if (!keep) {
          // Always replace image tags first if present
          if (isImg && fullTag) {
            newContent = newContent.replace(fullTag, "[UNREACHABLE_IMG]");
          }
          // Then replace any remaining text occurrences of the URL
          newContent = newContent.replace(url, "[UNREACHABLE_URL]");
        }
      });

      // Only update if content changed
      if (newContent !== item.content) {
        await drizzleDB
          .update(table)
          .set({ content: newContent })
          .where(eq(table.id, item.id));
      }
    }),
  );
}

export const GET = async (request: Request) => {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Verify CRON_SECRET header for authentication
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json(
      { error: "Unauthorized - Invalid or missing authorization header" },
      { status: 401 },
    );
  }

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Find all content with URLs
    const urlRegex = /(https?:\/\/[^\s"]+)/g;
    const [nindos, posts] = await Promise.all([
      drizzleDB.query.userNindo.findMany({
        where: or(
          like(userNindo.content, "%http://%"),
          like(userNindo.content, "%https://%"),
        ),
      }),
      drizzleDB.query.forumPost.findMany({
        where: or(
          like(forumPost.content, "%http://%"),
          like(forumPost.content, "%https://%"),
        ),
      }),
    ]);

    // Process nindos and forum posts in parallel
    await Promise.all([
      processContentUrls(nindos, userNindo, urlRegex),
      processContentUrls(posts, forumPost, urlRegex),
    ]);

    return Response.json(`OK`);
  } catch (cause) {
    // Type-check the error to ensure we're not silently catching programming errors
    if (!(cause instanceof Error)) {
      // Rollback and report all errors (expected and unexpected)
      await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
      return await handleEndpointError(cause);
    }

    // Expected error types: database errors, network errors from URL checks
    // Check stack trace to verify error origin before classification
    const stack = cause.stack || "";
    const isFetchError = isFetchOriginError(cause);

    const isDatabaseError =
      cause.name === "DrizzleError" ||
      cause.name.includes("DatabaseError") ||
      stack.includes("drizzle-orm");
    const isNetworkError =
      cause.name === "AbortError" || (cause.name === "TypeError" && isFetchError);

    // If it's not an expected error type, log additional context
    if (!isDatabaseError && !isNetworkError) {
      console.error("[daily-link-cleaner] Unexpected error type:", {
        name: cause.name,
        message: cause.message,
        stack: cause.stack,
      });
    }

    // Rollback and report all errors (expected and unexpected)
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
};
