/** Titles we never import: redirects, stubs, wiki meta, typo duplicates. */
export const FANDOM_SKIP_TITLES = [
  "Main Page",
  "The Ninja Rpg Wiki",
  "The Ninja-RPG Wiki",
  "Notable Locations",
  "Item Varients",
  "The Village of Current",
  "The Village of Shine",
] as const;

export const FANDOM_SKIP_TITLE_RE =
  /^(category|template|file|user|talk|special|help):/i;

export type FandomImportKind =
  | "skip"
  | "system"
  | "bloodline"
  | "item"
  | "jutsu"
  | "draft";

export interface FandomPage {
  title: string;
  wikitext: string;
}

export const isFandomRedirect = (wikitext: string) =>
  /^#redirect\s*\[\[/i.test(wikitext.trim());

export const isFandomStub = (wikitext: string) => {
  const text = wikitext.replace(/\{\{[^}]+\}\}/g, " ").replace(/\[\[[^\]]+\]\]/g, " ");
  const words = text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length < 40 || /PARAGRAPH HERE/i.test(wikitext);
};

export const shouldSkipFandomTitle = (title: string) => {
  if (FANDOM_SKIP_TITLE_RE.test(title)) return true;
  return (FANDOM_SKIP_TITLES as readonly string[]).some(
    (skip) => skip.toLowerCase() === title.toLowerCase(),
  );
};

const SYSTEM_ALIASES: Record<string, string> = {
  "getting started": "getting-started",
  "fresh player guide": "getting-started",
  combat: "combat",
  "game tags": "combat-tags",
  "prevent tags": "prevent-tags",
  "cleansable tags": "cleansable-tags",
  "clearable tags": "clearable-tags",
  "combat tag priority list": "combat-tag-priority",
  "combat fundamentals: loadout building": "loadout-building",
  "ai rule set": "ai-rules",
  "raid guidelines": "raids",
  "bracket system": "bracket-system",
  farming: "farming",
  villages: "villages",
  bloodlines: "bloodlines",
  "d ranks": "bloodlines",
  "auction house guidelines": "auction-house",
  "item variants": "item-variants",
};

export const matchSystemGuideSlug = (title: string) =>
  SYSTEM_ALIASES[title.trim().toLowerCase()];

export const classifyFandomPage = (
  page: FandomPage,
  names: { bloodlines: Set<string>; items: Set<string>; jutsus: Set<string> },
): FandomImportKind => {
  if (shouldSkipFandomTitle(page.title) || isFandomRedirect(page.wikitext)) {
    return "skip";
  }
  if (matchSystemGuideSlug(page.title)) return "system";
  if (isFandomStub(page.wikitext)) return "skip";
  const key = page.title.trim().toLowerCase();
  if (names.bloodlines.has(key)) return "bloodline";
  if (names.items.has(key)) return "item";
  if (names.jutsus.has(key)) return "jutsu";
  if (/^pvp guide/i.test(page.title)) return "draft";
  if (/^the village of /i.test(page.title)) return "draft";
  return "draft";
};

/** Pull visible prose from wikitext for lore snippets. Not a full MediaWiki parser. */
export const wikitextToPlainLore = (wikitext: string) =>
  wikitext
    .replace(/\{\{[\s\S]*?\}\}/g, " ")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[=]{2,}[^=]+[=]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
