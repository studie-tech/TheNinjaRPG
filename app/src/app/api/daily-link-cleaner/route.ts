import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { forumPost, userNindo } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "daily-link-cleaner";

interface UrlCheckResult {
  url: string;
  keep: boolean;
  isImg: boolean;
  fullTag?: string;
}

export async function isUrlAccessible(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log(`URL check (HEAD): ${url} - Status: ${response.status}`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.log(`URL check failed: ${url} - Error: ${errorMessage}`);
    return false;
  }
}

function isWithinImgTag(
  content: string,
  url: string,
): { isImg: boolean; fullTag?: string } {
  // Look for <img tags containing this URL
  const imgRegex = new RegExp(
    `<img[^>]*${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`,
    "i",
  );
  const match = content.match(imgRegex);
  return match ? { isImg: true, fullTag: match[0] } : { isImg: false };
}

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Find all content with URLs
    const urlRegex = /(https?:\/\/[^\s"]+)/g;
    const [nindos, posts] = await Promise.all([
      drizzleDB.query.userNindo.findMany({
        where: sql`content REGEXP ${urlRegex.source}`,
      }),
      drizzleDB.query.forumPost.findMany({
        where: sql`content REGEXP ${urlRegex.source}`,
      }),
    ]);

    // Process nindos and forum posts in parallel
    await Promise.all([
      // Process nindos
      Promise.all(
        nindos.map(async (nindo: (typeof nindos)[number]) => {
          // Extract all URLs from the content
          const urls = [...nindo.content.matchAll(urlRegex)].map((match) => match[0]);

          // Check all URLs in parallel
          const urlChecks = await Promise.all(
            urls.map(async (url) => {
              const isAccessible = await isUrlAccessible(url);
              const imgCheck = isWithinImgTag(nindo.content, url);
              return { url, keep: isAccessible, ...imgCheck } as UrlCheckResult;
            }),
          );

          // Replace inaccessible URLs
          let newContent = nindo.content;
          urlChecks.forEach(({ url, keep, isImg, fullTag }) => {
            if (!keep) {
              if (isImg && fullTag) {
                newContent = newContent.replace(fullTag, "[UNREACHABLE_IMG]");
              } else {
                newContent = newContent.replace(url, "[UNREACHABLE_URL]");
              }
            }
          });

          // Only update if content changed
          if (newContent !== nindo.content) {
            await drizzleDB
              .update(userNindo)
              .set({ content: newContent })
              .where(sql`id = ${nindo.id}`);
          }
        }),
      ),
      // Process forum posts
      Promise.all(
        posts.map(async (post: (typeof posts)[number]) => {
          // Extract all URLs from the content
          const urls = [...post.content.matchAll(urlRegex)].map((match) => match[0]);

          // Check all URLs in parallel
          const urlChecks = await Promise.all(
            urls.map(async (url) => {
              const isAccessible = await isUrlAccessible(url);
              const imgCheck = isWithinImgTag(post.content, url);
              return { url, keep: isAccessible, ...imgCheck } as UrlCheckResult;
            }),
          );

          // Replace inaccessible URLs
          let newContent = post.content;
          urlChecks.forEach(({ url, keep, isImg, fullTag }) => {
            if (!keep) {
              if (isImg && fullTag) {
                newContent = newContent.replace(fullTag, "[UNREACHABLE_IMG]");
              } else {
                newContent = newContent.replace(url, "[UNREACHABLE_URL]");
              }
            }
          });

          // Only update if content changed
          if (newContent !== post.content) {
            await drizzleDB
              .update(forumPost)
              .set({ content: newContent })
              .where(sql`id = ${post.id}`);
          }
        }),
      ),
    ]);

    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}
