import { desc, eq, gte } from "drizzle-orm";
import type { MetadataRoute } from "next";
import {
  bloodline,
  conceptImage,
  forumBoard,
  forumThread,
  item,
  jutsu,
  userData,
} from "@/drizzle/schema";
import { absoluteUrl } from "@/libs/seo";
import { drizzleDB } from "@/server/db";

// Regenerated hourly rather than per request: the content tables barely move and this
// issues seven queries.
export const revalidate = 3600;

// Cap on the number of player profiles listed. There are far more accounts than this,
// but low-level and abandoned characters are thin pages that dilute the sitemap.
const MAX_PROFILES = 5000;
const MIN_PROFILE_LEVEL = 10;

const STATIC_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/news", priority: 0.8, changeFrequency: "daily" },
  { path: "/manual", priority: 0.8, changeFrequency: "weekly" },
  { path: "/forum", priority: 0.7, changeFrequency: "daily" },
  { path: "/manual/bloodline", priority: 0.7, changeFrequency: "weekly" },
  { path: "/manual/jutsu", priority: 0.7, changeFrequency: "weekly" },
  { path: "/manual/item", priority: 0.7, changeFrequency: "weekly" },
  { path: "/manual/combat", priority: 0.7, changeFrequency: "monthly" },
  { path: "/manual/world", priority: 0.6, changeFrequency: "monthly" },
  { path: "/manual/quest", priority: 0.6, changeFrequency: "monthly" },
  { path: "/manual/ai", priority: 0.6, changeFrequency: "monthly" },
  { path: "/manual/skillTree", priority: 0.6, changeFrequency: "monthly" },
  { path: "/manual/crafting_recipes", priority: 0.6, changeFrequency: "monthly" },
  { path: "/manual/damage_calcs", priority: 0.5, changeFrequency: "monthly" },
  { path: "/manual/badge", priority: 0.5, changeFrequency: "monthly" },
  { path: "/manual/asset", priority: 0.4, changeFrequency: "monthly" },
  { path: "/manual/awards", priority: 0.4, changeFrequency: "weekly" },
  { path: "/manual/pvp_rank", priority: 0.5, changeFrequency: "daily" },
  { path: "/manual/activityStreak", priority: 0.4, changeFrequency: "monthly" },
  { path: "/manual/towerDefense", priority: 0.4, changeFrequency: "monthly" },
  { path: "/manual/towerDefense/leaderboard", priority: 0.4, changeFrequency: "daily" },
  { path: "/manual/world/sector-maps", priority: 0.4, changeFrequency: "monthly" },
  { path: "/manual/polls", priority: 0.4, changeFrequency: "weekly" },
  { path: "/manual/staff", priority: 0.4, changeFrequency: "monthly" },
  { path: "/manual/opinions", priority: 0.5, changeFrequency: "weekly" },
  { path: "/rules", priority: 0.4, changeFrequency: "monthly" },
  { path: "/help", priority: 0.4, changeFrequency: "monthly" },
  { path: "/conceptart", priority: 0.5, changeFrequency: "weekly" },
  { path: "/signup", priority: 0.9, changeFrequency: "monthly" },
  { path: "/login", priority: 0.6, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [bloodlines, jutsus, items, boards, threads, conceptArt, profiles] =
    await Promise.all([
      drizzleDB
        .select({ id: bloodline.id, updatedAt: bloodline.updatedAt })
        .from(bloodline)
        .where(eq(bloodline.hidden, false)),
      drizzleDB
        .select({ id: jutsu.id, updatedAt: jutsu.updatedAt })
        .from(jutsu)
        .where(eq(jutsu.hidden, false)),
      drizzleDB
        .select({ id: item.id, updatedAt: item.updatedAt })
        .from(item)
        .where(eq(item.hidden, false)),
      drizzleDB
        .select({ id: forumBoard.id, updatedAt: forumBoard.updatedAt })
        .from(forumBoard),
      drizzleDB
        .select({
          id: forumThread.id,
          boardId: forumThread.boardId,
          updatedAt: forumThread.updatedAt,
        })
        .from(forumThread),
      drizzleDB
        .select({ id: conceptImage.id, createdAt: conceptImage.createdAt })
        .from(conceptImage)
        .where(eq(conceptImage.status, "succeeded")),
      drizzleDB
        .select({ username: userData.username, updatedAt: userData.updatedAt })
        .from(userData)
        .where(gte(userData.level, MIN_PROFILE_LEVEL))
        .orderBy(desc(userData.level))
        .limit(MAX_PROFILES),
    ]);

  const now = new Date();

  return [
    ...STATIC_ROUTES.map((route) => ({
      url: absoluteUrl(route.path),
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...bloodlines.map((row) => ({
      url: absoluteUrl(`/manual/bloodline/${row.id}`),
      lastModified: row.updatedAt ?? now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...jutsus.map((row) => ({
      url: absoluteUrl(`/manual/jutsu/${row.id}`),
      lastModified: row.updatedAt ?? now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...items.map((row) => ({
      url: absoluteUrl(`/manual/item/${row.id}`),
      lastModified: row.updatedAt ?? now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...boards.map((row) => ({
      url: absoluteUrl(`/forum/${row.id}`),
      lastModified: row.updatedAt ?? now,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
    ...threads.map((row) => ({
      url: absoluteUrl(`/forum/${row.boardId}/${row.id}`),
      lastModified: row.updatedAt ?? now,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
    ...conceptArt.map((row) => ({
      url: absoluteUrl(`/conceptart/${row.id}`),
      lastModified: row.createdAt ?? now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
    ...profiles.map((row) => ({
      url: absoluteUrl(`/username/${encodeURIComponent(row.username)}`),
      lastModified: row.updatedAt ?? now,
      changeFrequency: "weekly" as const,
      priority: 0.3,
    })),
  ];
}
