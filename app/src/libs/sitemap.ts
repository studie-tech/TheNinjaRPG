import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  bloodline,
  forumBoard,
  forumThread,
  item,
  jutsu,
  userData,
} from "@/drizzle/schema";
import { absoluteUrl } from "@/libs/seo";
import type { SitemapEntry, SitemapSection } from "@/libs/sitemapXml";
import { drizzleDB } from "@/server/db";

/**
 * The sitemap is split by content type and fronted by an index at /sitemap.xml, because
 * Search Console reports coverage per submitted sitemap and one 8,000-row file made it
 * impossible to tell which template Google was rejecting. Serialization lives in
 * @/libs/sitemapXml so the index route need not import a database client.
 */

/** Caps on the tables that grow without limit, newest entries winning. */
const MAX_PROFILES = 2000;
const MIN_PROFILE_LEVEL = 25;
const PROFILE_ACTIVE_DAYS = 90;
const MAX_THREADS = 10000;

const STATIC_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: SitemapEntry["changeFrequency"];
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

/** Oldest `updatedAt` a profile may carry and still be advertised. */
const profileActivityCutoff = () =>
  new Date(Date.now() - PROFILE_ACTIVE_DAYS * 24 * 60 * 60 * 1000);

// No lastModified: these routes change when the code does, and the only timestamp
// available here is the request time, which would claim every page changed on every
// crawl. changefreq carries the same intent without asserting something false.
const staticEntries = (): SitemapEntry[] =>
  STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

const manualEntries = async (): Promise<SitemapEntry[]> => {
  const now = new Date();
  const [bloodlines, jutsus, items] = await Promise.all([
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
  ]);
  return [
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
  ];
};

const forumEntries = async (): Promise<SitemapEntry[]> => {
  const now = new Date();
  const [boards, threads] = await Promise.all([
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
  ]);
  return [
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
  ];
};

/**
 * Mirrors the visibility filters the public user listing already applies, so AI
 * characters, banned accounts and accounts pending deletion are never advertised. The
 * level floor and activity window keep abandoned and barely-started accounts out: Search
 * Console showed 5,000 submitted profiles earning roughly half a click each per year
 * while Google declined to index them.
 */
const profileEntries = async (): Promise<SitemapEntry[]> => {
  const now = new Date();
  const profiles = await drizzleDB
    .select({ username: userData.username, updatedAt: userData.updatedAt })
    .from(userData)
    .where(
      and(
        gte(userData.level, MIN_PROFILE_LEVEL),
        gte(userData.updatedAt, profileActivityCutoff()),
        eq(userData.isAi, false),
        eq(userData.isBanned, false),
        isNull(userData.deletionAt),
      ),
    )
    .orderBy(desc(userData.level))
    .limit(MAX_PROFILES);
  return profiles.map((row) => ({
    url: absoluteUrl(`/username/${encodeURIComponent(row.username)}`),
    lastModified: row.updatedAt ?? now,
    changeFrequency: "weekly" as const,
    priority: 0.3,
  }));
};

/** Query functions behind each child sitemap, keyed by the section name. */
export const SITEMAP_SECTION_LOADERS = {
  pages: staticEntries,
  manual: manualEntries,
  forum: forumEntries,
  profiles: profileEntries,
} satisfies Record<SitemapSection, () => Promise<SitemapEntry[]> | SitemapEntry[]>;
