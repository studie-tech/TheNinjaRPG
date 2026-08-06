import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
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

// Rendered per request rather than prerendered: this reads seven tables, and the build
// runs without a database, so baking it at build time fails the production build. The
// CDN caching that keeps the seven queries off the hot path is configured against
// /sitemap.xml in next.config.mjs.
export const dynamic = "force-dynamic";

// Caps on the unbounded tables. A sitemap may hold at most 50,000 URLs, and threads,
// concept art and accounts all grow without limit, so each is bounded and ordered so the
// newest entries win once a table outgrows its share. Content tables (bloodline, jutsu,
// item) are curated and small, so they stay uncapped.
const MAX_PROFILES = 5000;
const MIN_PROFILE_LEVEL = 10;
const MAX_THREADS = 10000;
const MAX_CONCEPT_ART = 5000;

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
        .from(forumThread)
        .orderBy(desc(forumThread.updatedAt))
        .limit(MAX_THREADS),
      // Deliberately not matched on `status`: the pipeline writes two different terminal
      // values ("succeeded" for images, "success" for the video path) and the public
      // listing filters on neither, so a status predicate silently drops rows. `done` is
      // the flag the pipeline actually maintains, and it is set in the same update that
      // stores the finished output — so a video whose thumbnail exists while the render
      // is still processing or has failed is excluded. `hidden` keeps anything withdrawn
      // from the gallery out of the index.
      drizzleDB
        .select({ id: conceptImage.id, createdAt: conceptImage.createdAt })
        .from(conceptImage)
        .where(
          and(
            eq(conceptImage.done, true),
            isNotNull(conceptImage.image),
            isNotNull(conceptImage.userId),
            eq(conceptImage.hidden, false),
          ),
        )
        .orderBy(desc(conceptImage.createdAt))
        .limit(MAX_CONCEPT_ART),
      // Mirrors the visibility filters the public user listing already applies, so AI
      // characters, banned accounts and accounts pending deletion are never advertised.
      drizzleDB
        .select({ username: userData.username, updatedAt: userData.updatedAt })
        .from(userData)
        .where(
          and(
            gte(userData.level, MIN_PROFILE_LEVEL),
            eq(userData.isAi, false),
            eq(userData.isBanned, false),
            isNull(userData.deletionAt),
          ),
        )
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
