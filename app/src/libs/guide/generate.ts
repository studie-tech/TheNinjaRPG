import { escapeUTF8 } from "entities";
import type { GuideCategory } from "@/drizzle/constants";
import { IMG_MANUAL_BLOODLINE, IMG_MANUAL_ITEM } from "@/drizzle/constants";
import type { GuideSeedArticle } from "@/libs/guide/articles";
import { slugifyGuideTitle } from "@/libs/guide/html";
import { htmlToPlainText } from "@/utils/sanitize";

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

const paragraph = (text: string) => `<p>${text}</p>`;
const heading = (text: string) => `<h2>${escapeUTF8(text)}</h2>`;
const link = (href: string, label: string) =>
  `<a href="${escapeUTF8(href)}">${escapeUTF8(label)}</a>`;

/**
 * Indefinite article for a word or a letter grade. A single letter is read by its name,
 * so "an A-rank" and "an S-rank" but "a B-rank": the vowel test alone said "a A-rank".
 */
const articleFor = (word: string) => {
  const w = word.trim();
  if (w.length === 1) return /^[aefhilmnorsx]$/i.test(w) ? "an" : "a";
  return /^[aeiou]/i.test(w) ? "an" : "a";
};

export const isGuideworthyEntityName = (name: string) =>
  !/^qa\b/i.test(name.trim()) && !/\s-\s*copy$/i.test(name.trim());

const loreParagraph = (description: string | null | undefined) => {
  const plain = htmlToPlainText(description ?? "");
  if (plain.length < 40) return "";
  return paragraph(escapeUTF8(plain.slice(0, 600)));
};

export const generateBloodlineGuide = (
  bloodline: BloodlineEntity,
): GuideSeedArticle => {
  const rank = bloodline.rank ?? "unranked";
  const slug = slugifyGuideTitle(bloodline.name);
  return {
    slug,
    title: `${bloodline.name} Bloodline`,
    subtitle: `${rank}-rank bloodline`,
    excerpt: `${bloodline.name} is ${articleFor(rank)} ${rank}-rank bloodline in TheNinja-RPG. Roll or buy it on Wake Island, then read the live effects in game data.`,
    seoTitle: `${bloodline.name} Bloodline Guide`,
    seoDescription: `${bloodline.name} is ${articleFor(rank)} ${rank}-rank bloodline in TheNinja-RPG. How to obtain it on Wake Island and where to read its jutsu and tags.`,
    category: "bloodlines" satisfies GuideCategory,
    image: bloodline.image || IMG_MANUAL_BLOODLINE,
    sortOrder: 80,
    published: true,
    content: [
      paragraph(
        `${escapeUTF8(bloodline.name)} is ${articleFor(rank)} ${escapeUTF8(rank)}-rank bloodline in TheNinja-RPG. This page is the how-to: where to get it and how it plays. Numbers stay on the encyclopedia.`,
      ),
      loreParagraph(bloodline.description),
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

export const generateItemGuide = (item: ItemEntity): GuideSeedArticle => {
  const rarity = item.rarity ?? item.itemType ?? "item";
  const slug = slugifyGuideTitle(item.name);
  return {
    slug,
    title: item.name,
    subtitle: `${rarity} item`,
    excerpt: `${item.name} is ${articleFor(String(rarity))} ${String(rarity).toLowerCase()} item in TheNinja-RPG. Stats stay on the item encyclopedia page.`,
    seoTitle: `${item.name} Guide`,
    seoDescription: `${item.name} in TheNinja-RPG: what it is, how players use it, and a link to live item data.`,
    category: "farming" satisfies GuideCategory,
    image: item.image || IMG_MANUAL_ITEM,
    sortOrder: 90,
    // Drafts until someone writes them. Twenty-eight of these went live at ~450
    // characters each, which is the near-duplicate shape Google's helpful-content
    // classifier keys on -- and that signal is site-wide. The farming hub lists every
    // seed and herb from live item data instead.
    published: false,
    content: [
      paragraph(
        `${escapeUTF8(item.name)} is listed in TheNinja-RPG as ${articleFor(String(rarity))} ${escapeUTF8(String(rarity).toLowerCase())} item. Use this page for context; the live stack size, cost and tags are on the encyclopedia.`,
      ),
      loreParagraph(item.description),
      heading("In game data"),
      paragraph(
        `${link(`/manual/item/${item.id}`, `Open ${item.name}`)} for current stats. Herbs and crops also appear in the ${link("/guide/farming", "farming guide")}.`,
      ),
    ].join(""),
  };
};
