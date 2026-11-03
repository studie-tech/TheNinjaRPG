import { getForumContext } from "@/libs/forum";
import { absoluteUrl } from "@/libs/seo";
import type { SitemapEntry, SitemapSection } from "@/libs/sitemapXml";
import {
  selectBloodlineForManualEntries,
  selectForumThreadForForumEntries,
  selectGuideArticleForGuideEntries,
  selectItemForManualEntries,
  selectJutsuForManualEntries,
  selectUserDataForProfileEntries,
} from "@/queries/sitemap";
import { drizzleDB } from "@/server/db";

/**
 * The sitemap is split by content type and fronted by an index at /sitemap.xml, because
 * Search Console reports coverage per submitted sitemap and one 8,000-row file made it
 * impossible to tell which template Google was rejecting. Serialization lives in
 * @/libs/sitemapXml so the index route need not import a database client.
 */

/** Caps on the tables that grow without limit, newest entries winning. */
const MAX_PROFILES = 2000;
const MAX_THREADS = 10000;

const STATIC_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: SitemapEntry["changeFrequency"];
}[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/news", priority: 0.8, changeFrequency: "daily" },
  { path: "/manual", priority: 0.8, changeFrequency: "weekly" },
  { path: "/guide", priority: 0.9, changeFrequency: "weekly" },
  { path: "/forum", priority: 0.7, changeFrequency: "daily" },
  { path: "/manual/bloodline", priority: 0.7, changeFrequency: "weekly" },
  { path: "/manual/jutsu", priority: 0.7, changeFrequency: "weekly" },
  { path: "/manual/item", priority: 0.7, changeFrequency: "weekly" },
  { path: "/manual/combat", priority: 0.7, changeFrequency: "monthly" },
  { path: "/guide/world", priority: 0.7, changeFrequency: "monthly" },
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
  { path: "/manual/polls", priority: 0.4, changeFrequency: "weekly" },
  { path: "/manual/staff", priority: 0.4, changeFrequency: "monthly" },
  { path: "/manual/opinions", priority: 0.5, changeFrequency: "weekly" },
  { path: "/rules", priority: 0.4, changeFrequency: "monthly" },
  { path: "/help", priority: 0.4, changeFrequency: "monthly" },
  { path: "/conceptart", priority: 0.5, changeFrequency: "weekly" },
  { path: "/signup", priority: 0.9, changeFrequency: "monthly" },
  { path: "/login", priority: 0.6, changeFrequency: "monthly" },
];

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
  const [bloodlines, jutsus, items] = await Promise.all([
    selectBloodlineForManualEntries(drizzleDB),
    selectJutsuForManualEntries(drizzleDB),
    selectItemForManualEntries(drizzleDB),
  ]);
  const toEntry = (prefix: string) => (row: { id: string; updatedAt: Date }) => ({
    url: absoluteUrl(`${prefix}/${row.id}`),
    lastModified: row.updatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  });
  return [
    ...bloodlines.map(toEntry("/manual/bloodline")),
    ...jutsus.map(toEntry("/manual/jutsu")),
    ...items.map(toEntry("/manual/item")),
  ];
};

const guideEntries = async (): Promise<SitemapEntry[]> => {
  const articles = await selectGuideArticleForGuideEntries(drizzleDB);
  return articles.map((row) => ({
    url: absoluteUrl(`/guide/${row.slug}`),
    lastModified: row.updatedAt,
    changeFrequency: "monthly" as const,
    priority: row.slug === "getting-started" ? 0.8 : 0.6,
  }));
};

/** Include only discussions whose entire board hierarchy permits public reading. */
const forumEntries = async (): Promise<SitemapEntry[]> => {
  const [context, allThreads] = await Promise.all([
    getForumContext(drizzleDB),
    selectForumThreadForForumEntries(drizzleDB, MAX_THREADS),
  ]);
  const boards = context.boards.filter((b) => b.permissions.read);
  const threads = allThreads.filter((t) => boards.some((b) => b.id === t.boardId));
  return [
    ...boards.map((row) => ({
      url: absoluteUrl(`/forum/${row.id}`),
      lastModified: row.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
    ...threads.map((row) => ({
      url: absoluteUrl(`/forum/${row.boardId}/${row.id}`),
      lastModified: row.updatedAt,
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
 * while Google declined to index them. The same rule, as a predicate, decides which
 * profile routes answer `noindex` -- see @/libs/profileIndexing.
 */
const profileEntries = async (): Promise<SitemapEntry[]> => {
  const profiles = await selectUserDataForProfileEntries(drizzleDB, MAX_PROFILES);
  return profiles.map((row) => ({
    url: absoluteUrl(`/username/${encodeURIComponent(row.username)}`),
    lastModified: row.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.3,
  }));
};

/** Query functions behind each child sitemap, keyed by the section name. */
export const SITEMAP_SECTION_LOADERS = {
  pages: staticEntries,
  manual: manualEntries,
  guide: guideEntries,
  forum: forumEntries,
  profiles: profileEntries,
} satisfies Record<SitemapSection, () => Promise<SitemapEntry[]> | SitemapEntry[]>;
