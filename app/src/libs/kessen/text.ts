/**
 * Card text generated from the structured ability list, so the printed text and the
 * engine cannot diverge. Keyword segments are marked for colouring and tooltips.
 */
import { type ItemRarity, KESSEN_MAX_KEYWORDS } from "@/drizzle/constants";
import type { KessenAbility, KessenFaction } from "@/validators/itemCard";
import { DEFAULT_KNOBS, permafrostHolds } from "./rules";
import type { KessenCard, KessenKnobs, Row } from "./types";

/** The fifteen keywords, in glossary order. */
export const KESSEN_KEYWORDS = [
  "Strike",
  "Empower",
  "Rally",
  "Bond",
  "Meditate",
  "Summon",
  "Infiltrator",
  "Revive",
  "Substitution",
  "Resilient",
  "Purge",
  "Terrain",
  "Clear Skies",
  "Seal",
  "Unyielding",
] as const;
export type KessenKeyword = (typeof KESSEN_KEYWORDS)[number];

/** Player-facing row names. */
export const ROW_LABELS: Record<Row, string> = {
  CLOSE: "Taijutsu",
  RANGED: "Bukijutsu",
  JUTSU: "Ninjutsu",
};

/** One-line explanation per keyword, for tooltips and the pre-match screen. */
export const KESSEN_GLOSSARY: Record<KessenKeyword, string> = {
  Strike: "Deploy: reduce an enemy unit's power by X; at 0 it is destroyed.",
  Empower: "Deploy: add X power to another unit on your side.",
  Rally: "Every other unit in this unit's row on your side shows +X.",
  Bond: `+${DEFAULT_KNOBS.bondStep} for each other unit on your side in the set it names, up to +${DEFAULT_KNOBS.bondCap}.`,
  Meditate: `At the start of each of your turns, gain X power, up to +${DEFAULT_KNOBS.meditateCap} in total.`,
  Summon:
    "Deploy: the top-most unit of your deck in the set it names joins the board, without its Deploy.",
  Infiltrator: "Placed on the opponent's side, where it counts for them; you draw 1.",
  Revive:
    "Deploy: play a unit from your discard that is not Unyielding, an Infiltrator or a Revive card.",
  Substitution: "Return a unit you own from your side to your hand, reset.",
  Resilient: "Stays on the board into the next round once, keeping its power.",
  Purge: `If the enemy row totals ${DEFAULT_KNOBS.purgeThreshold} or more, destroy its strongest non-Unyielding unit.`,
  Terrain: `Afflicts a row on both sides: each unit there shows -${DEFAULT_KNOBS.terrainPenalty}, minimum 1. A tactic or leader that would afflict nothing new cannot be played; on a unit it fizzles.`,
  "Clear Skies": "Removes all Terrain from both sides.",
  Seal: "The unit loses Rally, Bond, Meditate and Resilient while on the board.",
  Unyielding:
    "Ignores Terrain; cannot be Purged, Sealed, Substituted, Revived or carried over.",
};

/** Which sides a Terrain afflicts: both, or only the enemy's under Hyorin's Permafrost. */
export type TerrainReach = "both" | "enemy";

/**
 * Reach of Terrain cast by a seat of `faction`. In a match pass the view (or state) for
 * its round and knobs; outside one (deck builder, collection) the defaults apply.
 */
export const terrainReach = (
  faction: KessenFaction | null | undefined,
  at: {
    round?: number;
    knobs?: Pick<KessenKnobs, "permafrost" | "permafrostR3">;
  } = {},
): TerrainReach =>
  permafrostHolds(faction, at.round ?? 1, at.knobs ?? DEFAULT_KNOBS) ? "enemy" : "both";

/** A keyword's glossary line; Terrain names the one-sided case when `reach` is "enemy". */
export const keywordGlossary = (
  keyword: KessenKeyword,
  reach: TerrainReach = "both",
): string =>
  keyword === "Terrain" && reach === "enemy"
    ? `Permafrost: afflicts only the enemy's row: each unit there shows -${DEFAULT_KNOBS.terrainPenalty}, minimum 1. A tactic or leader that would afflict nothing new cannot be played; on a unit it fizzles.`
    : KESSEN_GLOSSARY[keyword];

/** Plain-language rules terms that are not keywords. */
export const KESSEN_TERMS = {
  "Any row": "Choose the row when you place it; it stays there.",
  Deploy: "Resolves once, when the card is played from hand or revived.",
  Token: "Created by a rule; banished at round end and never enters a discard.",
} as const;

/** A run of card text; keyword runs are marked for colouring and tooltips. */
export type TextSegment =
  | { t: "text"; s: string }
  | { t: "kw"; kw: KessenKeyword; s: string };

/** The keyword an ability belongs to; null for leader-only verbs. */
export const keywordOf = (ability: KessenAbility): KessenKeyword | null => {
  switch (ability.k) {
    case "strike":
      return "Strike";
    case "empower":
      return "Empower";
    case "rally":
      return "Rally";
    case "bond":
      return "Bond";
    case "meditate":
      return "Meditate";
    case "summon":
      return "Summon";
    case "infiltrator":
      return "Infiltrator";
    case "revive":
      return "Revive";
    case "substitution":
      return "Substitution";
    case "resilient":
    case "grantResilient":
      return "Resilient";
    case "purge":
      return "Purge";
    case "terrain":
      return "Terrain";
    case "clearSkies":
      return "Clear Skies";
    case "seal":
      return "Seal";
    case "unyielding":
      return "Unyielding";
    default:
      return null;
  }
};

/** Distinct keywords of an ability list in printed order (the rarity limit counts these). */
export const cardKeywords = (abilities: readonly KessenAbility[]): KessenKeyword[] => {
  const out: KessenKeyword[] = [];
  for (const ability of abilities) {
    const keyword = keywordOf(ability);
    if (keyword && !out.includes(keyword)) out.push(keyword);
  }
  return out;
};

/** Why a deck card of this rarity prints too many keywords, or null when it does not. */
export const keywordBudgetIssue = (
  abilities: readonly KessenAbility[],
  rarity: ItemRarity,
): string | null => {
  const max = KESSEN_MAX_KEYWORDS[rarity];
  return cardKeywords(abilities).length > max
    ? `A ${rarity.toLowerCase()} card may print at most ${max} keyword${max === 1 ? "" : "s"}`
    : null;
};

/**
 * Text segments of a card's abilities; sentences are separated by ". ". With `reach`
 * "enemy" (see `terrainReach`), Terrain phrases name the enemy row.
 */
export const abilitySegments = (
  abilities: readonly KessenAbility[],
  reach: TerrainReach = "both",
): TextSegment[] => {
  const sentences: TextSegment[][] = [];
  for (let i = 0; i < abilities.length; i++) {
    const ability = abilities[i];
    if (!ability) continue;
    const next = abilities[i + 1];
    if (ability.k === "seal" && ability.mode === "single" && isSameTargetStrike(next)) {
      const sentence = [
        kw("Seal", "Seal"),
        text(" an enemy unit, then "),
        kw("Strike", `Strike ${next.x}`),
        text(" it"),
      ];
      i++;
      const after = abilities[i + 1];
      if (after?.k === "strike" && after.mode === "single" && !after.sameTarget) {
        sentence.push(text(", then "), kw("Strike", `Strike ${after.x}`));
        i++;
      }
      sentences.push(sentence);
      continue;
    }
    if (
      ability.k === "strike" &&
      ability.mode === "single" &&
      next?.k === "strike" &&
      next.mode === "single" &&
      !next.sameTarget
    ) {
      sentences.push([
        kw("Strike", `Strike ${ability.x}`),
        text(", then "),
        kw("Strike", `Strike ${next.x}`),
      ]);
      i++;
      continue;
    }
    if (ability.k === "cycle" && next?.k === "draw" && !next.ifKilled) {
      sentences.push([
        text(
          `Choose up to ${ability.x} cards in your hand, put them on the bottom of your deck, then draw that many plus ${next.x}`,
        ),
      ]);
      i++;
      continue;
    }
    if (ability.k === "strike" && next?.k === "draw" && next.ifKilled) {
      sentences.push([
        ...abilityPhrase(ability, reach),
        text(`; if the target is destroyed, draw ${next.x}`),
      ]);
      i++;
      continue;
    }
    if (
      ability.k === "substitution" &&
      next?.k === "empower" &&
      next.mode === "single"
    ) {
      sentences.push([
        kw("Substitution", "Substitution"),
        text(", then "),
        kw("Empower", `Empower ${next.x}`),
        text(" another of your units"),
      ]);
      i++;
      continue;
    }
    sentences.push(abilityPhrase(ability, reach));
  }
  const out: TextSegment[] = [];
  sentences.forEach((sentence, index) => {
    if (index > 0) out.push(text(". "));
    out.push(...sentence);
  });
  return mergeText(out);
};

/** Plain text of a card's abilities ("—" when it has none). */
export const cardTextPlain = (card: Pick<KessenCard, "abilities">) => {
  const segments = abilitySegments(card.abilities);
  return segments.length === 0 ? "—" : segments.map((segment) => segment.s).join("");
};

const abilityPhrase = (ability: KessenAbility, reach: TerrainReach): TextSegment[] => {
  switch (ability.k) {
    case "strike": {
      const head = kw("Strike", `Strike ${ability.x}`);
      if (ability.mode === "oppositeRow")
        return [head, text(" each enemy unit in the opposite row")];
      if (ability.mode === "chosenRow")
        return [head, text(" each enemy unit in a chosen row")];
      if (ability.mode === "allEnemies") return [head, text(" each enemy unit")];
      return [head];
    }
    case "empower": {
      const head = kw("Empower", `Empower ${ability.x}`);
      if (ability.mode === "ownRowOthers")
        return [head, text(" each other unit in its row")];
      if (ability.mode === "chosenRow")
        return [head, text(" each unit in one of your rows")];
      if (ability.mode === "allMine") return [head, text(" each unit on your side")];
      return [head];
    }
    case "rally":
      return [kw("Rally", `Rally ${ability.x}`)];
    case "bond":
      return [kw("Bond", `Bond (${ability.group})`)];
    case "meditate":
      return [kw("Meditate", `Meditate ${ability.x}`)];
    case "summon":
      return [kw("Summon", `Summon (${ability.group})`)];
    case "infiltrator":
      return [kw("Infiltrator", "Infiltrator")];
    case "revive":
      return ability.times === 2
        ? [
            kw("Revive", "Revive"),
            text(", then "),
            kw("Revive", "Revive"),
            text(" again"),
          ]
        : [kw("Revive", "Revive")];
    case "substitution":
      return [kw("Substitution", "Substitution")];
    case "resilient":
      return [kw("Resilient", "Resilient")];
    case "grantResilient":
      return [
        text("One of your non-Unyielding units gains "),
        kw("Resilient", "Resilient"),
      ];
    case "purge": {
      const head = kw("Purge", "Purge");
      if (ability.mode === "chosenRow") return [head, text(" a chosen enemy row")];
      if (ability.mode === "eachEnemyRow") return [head, text(" each enemy row")];
      return [head];
    }
    case "terrain": {
      const enemy = reach === "enemy" ? "enemy " : "";
      if (ability.row === "chosen")
        return [kw("Terrain", "Terrain"), text(` on a chosen ${enemy}row`)];
      if (ability.row === "enemyMostUnits") {
        return [
          kw("Terrain", "Terrain"),
          text(" on the enemy row with the most units"),
        ];
      }
      return [kw("Terrain", `Terrain (${enemy}${ROW_LABELS[ability.row]})`)];
    }
    case "clearSkies":
      return [kw("Clear Skies", "Clear Skies")];
    case "unyielding":
      return [kw("Unyielding", "Unyielding")];
    case "seal": {
      const head = kw("Seal", "Seal");
      if (ability.mode === "chosenEnemyRow")
        return [head, text(" each enemy unit in a chosen row")];
      if (ability.mode === "joinRowOthers")
        return [head, text(" each other unit in the row it joins")];
      if (ability.mode === "upTo2") return [head, text(" up to 2 enemy units")];
      return [head];
    }
    case "draw":
      return [text(`Draw ${ability.x}`)];
    case "fence":
      return [
        text(
          "Deploy a unit card that is not Unyielding or an Infiltrator from the opponent's discard to your side; its Deploy abilities do not trigger. It counts as yours until it leaves the board, then returns to their discard",
        ),
      ];
    case "recall":
      return [
        text(
          "Return a unit card that is not Unyielding or an Infiltrator from your discard to your hand",
        ),
      ];
    case "allHands":
      return [
        text(
          "Deploy the top-most unit in your deck that has a Summon ability, to its row; its Summon then triggers",
        ),
      ];
    case "cycle":
      return [
        text(
          `Choose up to ${ability.x} cards in your hand, put them on the bottom of your deck, then draw that many`,
        ),
      ];
  }
};

const isSameTargetStrike = (
  ability: KessenAbility | undefined,
): ability is Extract<KessenAbility, { k: "strike" }> =>
  ability?.k === "strike" && ability.mode === "single" && ability.sameTarget === true;

const kw = (keyword: KessenKeyword, s: string): TextSegment => ({
  t: "kw",
  kw: keyword,
  s,
});
const text = (s: string): TextSegment => ({ t: "text", s });

const mergeText = (segments: TextSegment[]) => {
  const out: TextSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (segment.t === "text" && last?.t === "text") last.s += segment.s;
    else out.push({ ...segment });
  }
  return out;
};
