import type { GuideCategory } from "@/drizzle/constants";
import {
  IMG_MANUAL_BLOODLINE,
  IMG_MANUAL_ITEM,
  IMG_MANUAL_JUTSU,
} from "@/drizzle/constants";
import type { GuideSeedArticle } from "@/libs/guide/articles";
import { slugifyGuideTitle } from "@/libs/guide/html";

interface NamedEntity {
  id: string;
  name: string;
  description?: string | null;
  image?: string | null;
}

interface BloodlineEntity extends NamedEntity {
  rank?: string | null;
  hidden?: boolean | null;
}

interface ItemEntity extends NamedEntity {
  itemType?: string | null;
  rarity?: string | null;
  hidden?: boolean | null;
}

interface JutsuEntity extends NamedEntity {
  jutsuType?: string | null;
  jutsuRank?: string | null;
  hidden?: boolean | null;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const paragraph = (text: string) => `<p>${text}</p>`;
const heading = (text: string) => `<h2>${escapeHtml(text)}</h2>`;
const link = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

const articleFor = (word: string) => (/^[aeiou]/i.test(word.trim()) ? "an" : "a");

export const isGuideworthyEntityName = (name: string) =>
  !/^qa\b/i.test(name.trim()) && !/\s-\s*copy$/i.test(name.trim());

const stripHtml = (value: string | null | undefined) =>
  (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const loreParagraph = (description: string | null | undefined) => {
  const plain = stripHtml(description);
  if (plain.length < 40) return "";
  return paragraph(escapeHtml(plain.slice(0, 600)));
};

export const generateBloodlineGuide = (
  bloodline: BloodlineEntity,
  wikiLore?: string,
): GuideSeedArticle => {
  const rank = bloodline.rank ?? "unranked";
  const slug = slugifyGuideTitle(bloodline.name);
  return {
    slug,
    title: `${bloodline.name} Bloodline`,
    subtitle: `${rank}-rank bloodline`,
    excerpt: `${bloodline.name} is ${articleFor(rank)} ${rank}-rank bloodline in TheNinja-RPG. Roll or buy it on Wake Island, then read the live effects in game data.`,
    seoTitle: `${bloodline.name} TheNinja-RPG`,
    seoDescription: `${bloodline.name} is ${articleFor(rank)} ${rank}-rank bloodline in TheNinja-RPG. How to obtain it on Wake Island and where to read its jutsu and tags.`,
    category: "bloodlines" satisfies GuideCategory,
    image: bloodline.image || IMG_MANUAL_BLOODLINE,
    sortOrder: 80,
    published: true,
    sourceUrl: wikiLore
      ? `https://the-ninja-rpg.fandom.com/wiki/${encodeURIComponent(bloodline.name.replaceAll(" ", "_"))}`
      : undefined,
    content: [
      paragraph(
        `${escapeHtml(bloodline.name)} is ${articleFor(rank)} ${escapeHtml(rank)}-rank bloodline in TheNinja-RPG. This page is the how-to: where to get it and how it plays. Numbers stay on the encyclopedia.`,
      ),
      loreParagraph(wikiLore) || loreParagraph(bloodline.description),
      heading("How to obtain"),
      paragraph(
        `Travel to ${link("/guide/wake-island", "Wake Island")} and roll or purchase the line. Rank prices and free starter rolls are listed there. S-rank lines are event-only.`,
      ),
      heading("How it plays"),
      paragraph(
        `Open ${link(`/manual/bloodline/${bloodline.id}`, `${bloodline.name} in game data`)} for elements, tags and exclusive jutsu. Pair it with a ${link("/guide/loadout-building", "loadout")} that uses those tags instead of copying an old PvP paste.`,
      ),
      heading("See also"),
      paragraph(
        `${link("/guide/bloodlines", "All bloodlines")} · ${link("/guide/combat", "Combat")} · ${link("/manual/bloodline", "Bloodline database")}`,
      ),
    ].join(""),
  };
};

export const generateItemGuide = (
  item: ItemEntity,
  wikiLore?: string,
): GuideSeedArticle => {
  const rarity = item.rarity ?? item.itemType ?? "item";
  const slug = slugifyGuideTitle(item.name);
  return {
    slug,
    title: item.name,
    subtitle: `${rarity} item`,
    excerpt: `${item.name} is ${articleFor(String(rarity))} ${String(rarity).toLowerCase()} item in TheNinja-RPG. Stats stay on the item encyclopedia page.`,
    seoTitle: `${item.name} TheNinja-RPG`,
    seoDescription: `${item.name} in TheNinja-RPG: what it is, how players use it, and a link to live item data.`,
    category: "farming" satisfies GuideCategory,
    image: item.image || IMG_MANUAL_ITEM,
    sortOrder: 90,
    published: true,
    sourceUrl: wikiLore
      ? `https://the-ninja-rpg.fandom.com/wiki/${encodeURIComponent(item.name.replaceAll(" ", "_"))}`
      : undefined,
    content: [
      paragraph(
        `${escapeHtml(item.name)} is listed in TheNinja-RPG as ${articleFor(String(rarity))} ${escapeHtml(String(rarity).toLowerCase())} item. Use this page for context; the live stack size, cost and tags are on the encyclopedia.`,
      ),
      loreParagraph(wikiLore) || loreParagraph(item.description),
      heading("In game data"),
      paragraph(
        `${link(`/manual/item/${item.id}`, `Open ${item.name}`)} for current stats. Herbs and crops also appear in the ${link("/guide/farming", "farming guide")}.`,
      ),
    ].join(""),
  };
};

export const generateJutsuGuide = (
  jutsu: JutsuEntity,
  wikiLore?: string,
): GuideSeedArticle => {
  const rank = jutsu.jutsuRank ?? "unranked";
  const type = jutsu.jutsuType ?? "jutsu";
  const slug = slugifyGuideTitle(jutsu.name);
  return {
    slug,
    title: jutsu.name,
    subtitle: `${rank} ${type}`,
    excerpt: `${jutsu.name} is ${articleFor(rank)} ${rank}-rank ${String(type).toLowerCase()} jutsu in TheNinja-RPG.`,
    seoTitle: `${jutsu.name} TheNinja-RPG`,
    seoDescription: `${jutsu.name} is ${articleFor(rank)} ${rank}-rank ${String(type).toLowerCase()} jutsu in TheNinja-RPG. Read playstyle here and live numbers in the jutsu encyclopedia.`,
    category: "reference" satisfies GuideCategory,
    image: jutsu.image || IMG_MANUAL_JUTSU,
    sortOrder: 100,
    published: true,
    sourceUrl: wikiLore
      ? `https://the-ninja-rpg.fandom.com/wiki/${encodeURIComponent(jutsu.name.replaceAll(" ", "_"))}`
      : undefined,
    content: [
      paragraph(
        `${escapeHtml(jutsu.name)} is ${articleFor(rank)} ${escapeHtml(rank)}-rank ${escapeHtml(String(type).toLowerCase())} jutsu. Damage, cooldown and tags change with balance — this page will not copy a wiki stat block.`,
      ),
      loreParagraph(wikiLore) || loreParagraph(jutsu.description),
      heading("In game data"),
      paragraph(
        `${link(`/manual/jutsu/${jutsu.id}`, `Open ${jutsu.name}`)} for the live card. See ${link("/guide/combat-tags", "game tags")} for what those effects mean.`,
      ),
    ].join(""),
  };
};
