import { forumPost, userNindo } from "@/drizzle/schema";
import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  listForumPostForGET,
  listUserNindoForGET,
  updateTableForProcessContentUrls,
} from "@/queries/cleaner";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { isUrlAccessible, isWithinImgTag } from "@/server/utils/url";

const ENDPOINT_NAME = "daily-link-cleaner";

export const GET = async (request: Request) => {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-link-cleaner", async () => {
    // Find all content with URLs
    const urlRegex = /(https?:\/\/[^\s"]+)/g;
    const [nindos, posts] = await Promise.all([
      listUserNindoForGET(drizzleDB),
      listForumPostForGET(drizzleDB),
    ]);

    // Process nindos and forum posts in parallel
    await Promise.all([
      processContentUrls(nindos, userNindo, urlRegex),
      processContentUrls(posts, forumPost, urlRegex),
    ]);

    return Response.json(`OK`);
  });
};

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
            newContent = newContent.replaceAll(fullTag, "[UNREACHABLE_IMG]");
          }
          // Then replace any remaining text occurrences of the URL
          newContent = newContent.replaceAll(url, "[UNREACHABLE_URL]");
        }
      });

      // Only update if content changed
      if (newContent !== item.content) {
        await updateTableForProcessContentUrls(drizzleDB, table, newContent, item);
      }
    }),
  );
}

interface UrlCheckResult {
  url: string;
  keep: boolean;
  isImg: boolean;
  fullTag?: string;
}
