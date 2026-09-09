/**
 * Dump the Fandom wiki via MediaWiki API, classify pages, and upsert GuideArticle
 * rows. System guides come from first-party rewrites; entity pages are generated
 * from the live database. Stubs, redirects and wiki-meta are skipped.
 *
 * Usage (from /app):
 *   bun run scripts/import-fandom-guide.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { bloodline, guideArticle, item, jutsu } from "@/drizzle/schema";
import { SYSTEM_GUIDE_ARTICLES } from "@/libs/guide/articles";
import {
  classifyFandomPage,
  wikitextToPlainLore,
  type FandomPage,
} from "@/libs/guide/fandom";
import { factCheckGuideProse } from "@/libs/guide/factcheck";
import {
  generateBloodlineGuide,
  generateItemGuide,
  generateJutsuGuide,
  isGuideworthyEntityName,
} from "@/libs/guide/generate";
import { isReservedGuideSlug, slugifyGuideTitle } from "@/libs/guide/html";
import { drizzleDB } from "@/server/db";

const API = "https://the-ninja-rpg.fandom.com/api.php";
const USER_AGENT = "TheNinjaRPG-GuideImport/1.0 (https://www.theninja-rpg.com/guide)";

const apiGet = async (params: Record<string, string>) => {
  const url = new URL(API);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Fandom API ${response.status} for ${url.searchParams.get("action")}`);
  }
  return (await response.json()) as Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const listAllTitles = async () => {
  const titles: string[] = [];
  let continuation: string | undefined;
  do {
    const data = (await apiGet({
      action: "query",
      list: "allpages",
      aplimit: "max",
      apnamespace: "0",
      ...(continuation ? { apcontinue: continuation } : {}),
    })) as {
      query?: { allpages?: { title: string }[] };
      continue?: { apcontinue?: string };
    };
    for (const page of data.query?.allpages ?? []) {
      titles.push(page.title);
    }
    continuation = data.continue?.apcontinue;
    await sleep(800);
  } while (continuation);
  return titles;
};

const fetchWikitext = async (titles: string[]) => {
  const pages: FandomPage[] = [];
  for (let index = 0; index < titles.length; index += 20) {
    const batch = titles.slice(index, index + 20);
    const data = (await apiGet({
      action: "query",
      titles: batch.join("|"),
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
    })) as {
      query?: {
        pages?: {
          title: string;
          revisions?: { slots?: { main?: { content?: string } } }[];
        }[];
      };
    };
    for (const page of data.query?.pages ?? []) {
      const wikitext = page.revisions?.[0]?.slots?.main?.content ?? "";
      pages.push({ title: page.title, wikitext });
    }
    await sleep(800);
  }
  return pages;
};

const upsert = async (values: {
  slug: string;
  title: string;
  subtitle?: string | null;
  excerpt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  category: (typeof SYSTEM_GUIDE_ARTICLES)[number]["category"];
  content: string;
  image?: string | null;
  faq?: { question: string; answer: string }[] | null;
  sortOrder: number;
  published: boolean;
  sourceUrl?: string | null;
  reviewNotes?: string | null;
  relatedBloodlineId?: string | null;
  relatedItemId?: string | null;
  relatedJutsuId?: string | null;
}) => {
  if (isReservedGuideSlug(values.slug)) return "skipped";
  const existing = await drizzleDB.query.guideArticle.findFirst({
    columns: { id: true },
    where: eq(guideArticle.slug, values.slug),
  });
  if (existing) {
    await drizzleDB
      .update(guideArticle)
      .set(values)
      .where(eq(guideArticle.id, existing.id));
    return "updated";
  }
  await drizzleDB.insert(guideArticle).values({ id: nanoid(), ...values });
  return "inserted";
};

const main = async () => {
  console.log("Seeding first-party system guides...");
  for (const article of SYSTEM_GUIDE_ARTICLES) {
    const issues = factCheckGuideProse(`${article.title} ${article.content}`);
    await upsert({
      ...article,
      image: article.image ?? null,
      faq: article.faq ?? null,
      sourceUrl: article.sourceUrl ?? null,
      published: issues.length > 0 ? false : article.published,
      reviewNotes:
        issues.length > 0
          ? [...(article.reviewNotes ? [article.reviewNotes] : []), ...issues.map((issue) => issue.message)].join("\n")
          : article.reviewNotes ?? null,
    });
  }

  const [bloodlines, items, jutsus] = await Promise.all([
    drizzleDB.query.bloodline.findMany({
      columns: {
        id: true,
        name: true,
        description: true,
        image: true,
        rank: true,
        hidden: true,
      },
      where: eq(bloodline.hidden, false),
    }),
    drizzleDB.query.item.findMany({
      columns: {
        id: true,
        name: true,
        description: true,
        image: true,
        itemType: true,
        rarity: true,
        hidden: true,
      },
      where: eq(item.hidden, false),
    }),
    drizzleDB.query.jutsu.findMany({
      columns: {
        id: true,
        name: true,
        description: true,
        image: true,
        jutsuType: true,
        jutsuRank: true,
        hidden: true,
      },
      where: eq(jutsu.hidden, false),
    }),
  ]);

  const names = {
    bloodlines: new Set(bloodlines.map((row) => row.name.toLowerCase())),
    items: new Set(items.map((row) => row.name.toLowerCase())),
    jutsus: new Set(jutsus.map((row) => row.name.toLowerCase())),
  };
  const systemSlugs = new Set(SYSTEM_GUIDE_ARTICLES.map((article) => article.slug));

  console.log("Fetching Fandom allpages...");
  const titles = await listAllTitles();
  console.log(`Found ${titles.length} titles`);
  const pages = await fetchWikitext(titles);

  const counts = { skip: 0, system: 0, bloodline: 0, item: 0, jutsu: 0, draft: 0 };

  for (const page of pages) {
    const kind = classifyFandomPage(page, names);
    counts[kind] += 1;
    const lore = wikitextToPlainLore(page.wikitext);
    const sourceUrl = `https://the-ninja-rpg.fandom.com/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`;

    if (kind === "skip" || kind === "system") continue;

    if (kind === "bloodline") {
      const row = bloodlines.find((entry) => entry.name.toLowerCase() === page.title.toLowerCase());
      if (!row || !isGuideworthyEntityName(row.name)) continue;
      const generated = generateBloodlineGuide(row, lore);
      if (systemSlugs.has(generated.slug)) continue;
      await upsert({ ...generated, relatedBloodlineId: row.id, sourceUrl });
      continue;
    }
    if (kind === "item") {
      const row = items.find((entry) => entry.name.toLowerCase() === page.title.toLowerCase());
      if (!row || !isGuideworthyEntityName(row.name)) continue;
      const generated = generateItemGuide(row, lore);
      if (systemSlugs.has(generated.slug)) continue;
      await upsert({ ...generated, relatedItemId: row.id, sourceUrl });
      continue;
    }
    if (kind === "jutsu") {
      const row = jutsus.find((entry) => entry.name.toLowerCase() === page.title.toLowerCase());
      if (!row || !isGuideworthyEntityName(row.name)) continue;
      const generated = generateJutsuGuide(row, lore);
      if (systemSlugs.has(generated.slug)) continue;
      await upsert({ ...generated, relatedJutsuId: row.id, sourceUrl });
      continue;
    }

    const slug = slugifyGuideTitle(page.title);
    if (!slug || systemSlugs.has(slug) || isReservedGuideSlug(slug)) continue;
    const issues = factCheckGuideProse(lore);
    await upsert({
      slug,
      title: page.title,
      subtitle: "Needs staff rewrite",
      excerpt: lore.slice(0, 200) || `Draft imported from the community wiki: ${page.title}`,
      seoTitle: `${page.title} TheNinja-RPG`,
      seoDescription: `Staff draft for ${page.title} in TheNinja-RPG. Not published until rewritten against live game data.`,
      category: /^pvp guide/i.test(page.title)
        ? "combat"
        : /^the village of /i.test(page.title)
          ? "villages"
          : "reference",
      content: `<p>This draft was classified from the community wiki and is held for rewrite. Do not publish until the facts match live game data.</p><p>${lore.replaceAll("<", "&lt;")}</p>`,
      sortOrder: 200,
      published: false,
      sourceUrl,
      reviewNotes: [
        "Imported as draft from Fandom. Rewrite before publishing.",
        ...issues.map((issue) => issue.message),
      ].join("\n"),
    });
  }

  console.log("Import complete", counts);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
