import { describe, expect, it } from "bun:test";
import { KESSEN_NPC_NAMES } from "@/drizzle/constants";
import {
  catalogById,
  expandDeckCards,
  KESSEN_ALT_LEADERS,
  KESSEN_DECK_FACTIONS,
  starterDeck,
  validateDeck,
} from "@/libs/kessen/deck";
import { createMatch } from "@/libs/kessen/engine";
import {
  ascendedDeckOf,
  championKeys,
  homeFaction,
  KESSEN_NPCS,
  type KessenCircuitProgress,
  type KessenNpc,
  type KessenNpcKey,
  kessenNpc,
  momoFaction,
  npcDropPool,
  npcForbiddenPool,
  npcLockReason,
  npcVariant,
  villageFaction,
} from "@/libs/kessen/npcs";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { KESSEN_DROP_TABLES } from "@/libs/kessen/rewards";
import { KESSEN_KEYWORDS } from "@/libs/kessen/text";
import type { KessenCard } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

const CATALOG = catalogById(KESSEN_SEED_CATALOG);
const npc = (key: KessenNpcKey) => kessenNpc(key) as KessenNpc;

/** Provision, budget, units and tactics of every signature deck. */
const SIGNATURE_TABLE: Record<KessenNpcKey, [number, number, number, number]> = {
  lemu: [140, 161, 21, 4],
  kazehiko: [138, 163, 22, 3],
  hisame: [138, 160, 20, 5],
  junko: [130, 163, 21, 4],
  kimiko: [143, 161, 23, 2],
  "crowned-captain": [135, 162, 19, 6],
  "kaze-no-seirei": [136, 162, 20, 5],
  ravena: [148, 160, 21, 4],
  "anbu-chief": [154, 161, 22, 3],
  momo: [147, 162, 18, 7],
  shishi: [173, 185, 21, 4],
  unmeishi: [171, 180, 20, 5],
};

/** Ascended provision and budget. */
const ASCENDED_TABLE: Partial<Record<KessenNpcKey, [number, number]>> = {
  hisame: [153, 160],
  junko: [145, 163],
  kimiko: [159, 161],
  "crowned-captain": [150, 162],
  "kaze-no-seirei": [152, 162],
  ravena: [157, 160],
};

const progress = (
  over: Partial<KessenCircuitProgress> = {},
): KessenCircuitProgress => ({
  lessonCompleted: true,
  beaten: [],
  ascendedBeaten: [],
  homeFaction: null,
  ...over,
});

const unlocked = (...args: Parameters<typeof npcLockReason>) =>
  npcLockReason(...args) === null;

describe("NPC roster", () => {
  it("names every NPC as quest objectives show it", () => {
    expect(
      Object.fromEntries(KESSEN_NPCS.map((entry) => [entry.key, entry.name])),
    ).toEqual(KESSEN_NPC_NAMES);
  });

  it("lists the twelve NPCs in unlock order", () => {
    expect(KESSEN_NPCS.map((entry) => [entry.key, entry.standard.tier])).toEqual([
      ["lemu", "GENIN"],
      ["kazehiko", "GENIN"],
      ["hisame", "CHUNIN"],
      ["junko", "CHUNIN"],
      ["kimiko", "CHUNIN"],
      ["crowned-captain", "CHUNIN"],
      ["kaze-no-seirei", "CHUNIN"],
      ["ravena", "CHUNIN"],
      ["anbu-chief", "JONIN"],
      ["momo", "JONIN"],
      ["shishi", "KAGE"],
      ["unmeishi", "KAGE"],
    ]);
    expect(championKeys()).toEqual([
      "hisame",
      "junko",
      "kimiko",
      "crowned-captain",
      "kaze-no-seirei",
      "ravena",
    ]);
    expect(KESSEN_NPCS.filter((entry) => entry.boss).map((entry) => entry.key)).toEqual(
      ["shishi", "unmeishi"],
    );
  });

  it("uses the drop table of each tier", () => {
    const tables = Object.fromEntries(
      KESSEN_NPCS.map((entry) => [
        entry.key,
        [entry.standard.dropTable, entry.ascended?.dropTable ?? null],
      ]),
    );
    expect(tables).toEqual({
      lemu: ["NOVICE", null],
      kazehiko: ["NOVICE", null],
      hisame: ["ADEPT", "MASTER"],
      junko: ["ADEPT", "MASTER"],
      kimiko: ["ADEPT", "MASTER"],
      "crowned-captain": ["ADEPT", "MASTER"],
      "kaze-no-seirei": ["ADEPT", "MASTER"],
      ravena: ["ADEPT", "MASTER"],
      "anbu-chief": ["MASTER", null],
      momo: ["MASTER", null],
      shishi: ["KAGE", null],
      unmeishi: ["KAGE", null],
    });
    for (const entry of KESSEN_NPCS) {
      if (entry.ascended) expect(entry.ascended.tier).toBe("JONIN");
    }
  });

  it("gives every NPC a leader of its faction, portraits, barks and known keywords", () => {
    for (const entry of KESSEN_NPCS) {
      for (const variant of [entry.standard, entry.ascended]) {
        if (!variant) continue;
        const leader = CATALOG[variant.deck.leaderId] as KessenCard;
        expect([entry.key, leader.kind, leader.faction]).toEqual([
          entry.key,
          "LEADER",
          entry.faction,
        ]);
        expect(leader.isCollectible).toBe(!entry.boss);
      }
      expect(entry.image).toMatch(/^https:\/\/[a-z0-9.-]+\/f\/\S+\.webp$/);
      if (entry.divineImage) expect(entry.divineImage).toMatch(/^https:\/\//);
      for (const line of Object.values(entry.barks))
        expect(line.length).toBeGreaterThan(0);
      for (const keyword of entry.teaches) expect(KESSEN_KEYWORDS).toContain(keyword);
      expect(entry.name).not.toBe("");
      expect(kessenNpc(entry.key)).toBe(entry);
    }
    expect(kessenNpc("nobody")).toBeUndefined();
  });

  it("keeps champion leaders as their faction's alt leader", () => {
    for (const entry of KESSEN_NPCS.filter((item) => item.champion)) {
      expect(entry.standard.deck.leaderId).toBe(KESSEN_ALT_LEADERS[entry.faction]);
    }
  });
});

describe("NPC decks", () => {
  for (const entry of KESSEN_NPCS) {
    it(`${entry.key} signature deck validates with the design numbers`, () => {
      const result = validateDeck(entry.standard.deck, CATALOG, { boss: entry.boss });
      expect(result.errors).toEqual([]);
      const [provision, budget, units, tactics] = SIGNATURE_TABLE[entry.key];
      expect(result.stats).toMatchObject({
        cards: 25,
        provision,
        budget,
        units,
        tactics,
      });
      if (entry.boss) {
        expect(result.stats.legendaries).toBe(3);
        expect(
          validateDeck(entry.standard.deck, CATALOG).errors.map((e) => e.code),
        ).toEqual(["notCollectible", "legendaries"]);
      }
    });
  }

  for (const entry of KESSEN_NPCS.filter((item) => item.ascended)) {
    it(`${entry.key} Ascended deck validates with the design numbers`, () => {
      const deck = entry.ascended?.deck as KessenNpc["standard"]["deck"];
      const result = validateDeck(deck, CATALOG);
      expect(result.errors).toEqual([]);
      const [provision, budget] = ASCENDED_TABLE[entry.key] as [number, number];
      expect(result.stats).toMatchObject({ cards: 25, provision, budget });
      expect(result.stats.legendaries).toBe(1);
      expect(result.stats.infiltrators).toBeLessThanOrEqual(2);
    });
  }

  it("derives Ascended decks by their formula", () => {
    const ravena = ascendedDeckOf(npc("ravena").standard.deck, "SYNDICATE");
    const counts = Object.fromEntries(
      ravena.cards.map((entry) => [entry.itemId, entry.count]),
    );
    expect(counts["kessen-oblivion-seal-bearer"]).toBe(1);
    expect(counts["kessen-kawarimi"]).toBe(1);
    expect(counts["kessen-the-caged-sovereign"]).toBe(1);
    expect(counts["kessen-musashi-ken-swordsman"]).toBeUndefined();
    const junko = ascendedDeckOf(npc("junko").standard.deck, "TSUKIMORI");
    const junkoCounts = Object.fromEntries(
      junko.cards.map((entry) => [entry.itemId, entry.count]),
    );
    expect(junkoCounts["kessen-musashi-ken-swordsman"]).toBe(1);
    expect(junkoCounts["kessen-colossus"]).toBe(1);
    expect(junkoCounts["kessen-yasei-no-seirei-the-wild-spirit"]).toBe(1);
  });

  it("starts an engine match for every NPC deck", () => {
    for (const entry of KESSEN_NPCS) {
      for (const variant of [entry.standard, entry.ascended]) {
        if (!variant) continue;
        const human = starterDeck("HYORIN");
        const state = createMatch({
          seed: `npc:${entry.key}`,
          seats: [
            { leaderId: human.leaderId, deck: expandDeckCards(human.cards) },
            {
              leaderId: variant.deck.leaderId,
              deck: expandDeckCards(variant.deck.cards),
            },
          ],
          rules: variant.rules,
          cards: KESSEN_SEED_CATALOG,
        });
        expect(state.seats[1].hand.length).toBe(10);
      }
    }
  });
});

describe("house rules", () => {
  it("map to their engine flags", () => {
    const rules = Object.fromEntries(
      KESSEN_NPCS.map((entry) => [
        entry.key,
        { standard: entry.standard.rules, ascended: entry.ascended?.rules ?? null },
      ]),
    );
    expect(rules.hisame?.ascended).toEqual({ r3PlacementBonus: 1 });
    expect(rules.junko?.ascended).toEqual({ carryBonus: 2 });
    expect(rules.kimiko?.ascended).toEqual({
      startTerrain: [{ row: "CLOSE", rounds: [1, 2, 3] }],
    });
    expect(rules["crowned-captain"]?.ascended).toEqual({
      startTerrain: [{ row: "JUTSU", rounds: [1] }],
    });
    expect(rules["kaze-no-seirei"]?.ascended).toEqual({ extraMulligans: 1 });
    expect(rules.ravena?.ascended).toEqual({ strikeBonus: 1 });
    expect(rules.momo?.standard).toEqual({ r1MulliganCap: 5 });
    expect(rules.shishi?.standard).toEqual({ extraMulligans: { seat: "human", n: 1 } });
    expect(rules.unmeishi?.standard).toEqual({
      leaderRecharge: "onRoundLoss",
      leaderRechargeSeat: 1,
    });
    for (const key of ["lemu", "kazehiko", "anbu-chief"] as const) {
      expect(rules[key]?.standard).toEqual({});
    }
    for (const entry of KESSEN_NPCS) {
      for (const variant of [entry.standard, entry.ascended]) {
        if (!variant) continue;
        expect(variant.houseRule === null).toBe(
          Object.keys(variant.rules).length === 0,
        );
      }
    }
  });
});

describe("first-win rewards", () => {
  const packIds = new Set<string>([
    KESSEN_PACK_IDS.paper,
    KESSEN_PACK_IDS.lacquer,
    KESSEN_PACK_IDS.first,
    ...KESSEN_DECK_FACTIONS.map((faction) => KESSEN_PACK_IDS.village(faction)),
  ]);

  it("reference catalog cards or pack items only", () => {
    for (const entry of KESSEN_NPCS) {
      for (const variant of [entry.standard, entry.ascended]) {
        if (!variant) continue;
        for (const grant of variant.firstWin.items) {
          expect(grant.quantity).toBeGreaterThan(0);
          expect(Boolean(CATALOG[grant.itemId]) || packIds.has(grant.itemId)).toBe(
            true,
          );
        }
        const choice = variant.firstWin.choice;
        if (choice?.kind === "items") {
          for (const id of choice.itemIds) expect(CATALOG[id]?.rarity).toBe("EPIC");
        }
      }
    }
  });

  it("grant the first-win rewards of each NPC", () => {
    const items = (key: KessenNpcKey) =>
      npc(key).standard.firstWin.items.map((i) => i.itemId);
    expect(items("lemu")).toEqual([
      "kessen-lemu-academy-instructor",
      "kessen-pack-paper",
    ]);
    expect(items("kazehiko")).toEqual(["kessen-kazehiko", "kessen-pack-paper"]);
    expect(items("hisame")).toEqual([
      "kessen-leader-subaku-demon-lord",
      "kessen-pack-village-shirohana",
    ]);
    expect(npc("ravena").ascended?.firstWin.choice).toEqual({
      kind: "items",
      itemIds: ["kessen-headless-rider", "kessen-kinjutsu-black-thorn-rose"],
    });
    expect(items("anbu-chief")).toEqual(["kessen-anbu-chief", "kessen-pack-lacquer"]);
    expect(items("momo")).toEqual(["kessen-pack-lacquer"]);
    expect(npc("shishi").standard.firstWin).toMatchObject({
      items: [{ itemId: "kessen-shishi-god-of-death", quantity: 1 }],
      badge: "Night Parade Survivor",
    });
    expect(npc("unmeishi").standard.firstWin).toEqual({
      items: [],
      choice: { kind: "unownedLegendary" },
      title: "Thread-Reader",
    });
  });
});

describe("drop pools", () => {
  it("cover every rarity a table can roll, Forbidden only for Kage", () => {
    for (const entry of KESSEN_NPCS) {
      const pool = npcDropPool(entry, KESSEN_SEED_CATALOG);
      expect(pool.every((card) => card.kind !== "LEADER" && card.isCollectible)).toBe(
        true,
      );
      const table = KESSEN_DROP_TABLES[entry.standard.dropTable ?? "NOVICE"];
      for (const [rarity, weight] of Object.entries(table.rarityBp)) {
        if (weight > 0) {
          expect({
            key: entry.key,
            rarity,
            has: pool.some((c) => c.rarity === rarity),
          }).toEqual({
            key: entry.key,
            rarity,
            has: true,
          });
        }
      }
      const forbidden = npcForbiddenPool(entry, KESSEN_SEED_CATALOG);
      expect(forbidden.length).toBe(
        entry.key === "shishi" ? 1 : entry.key === "unmeishi" ? 10 : 0,
      );
    }
    expect(npcForbiddenPool(npc("shishi"), KESSEN_SEED_CATALOG)[0]?.id).toBe(
      "kessen-forbidden-shishi-god-of-death",
    );
  });

  it("include the champion's faction legendary through the Ascended deck", () => {
    const ids = npcDropPool(npc("kimiko"), KESSEN_SEED_CATALOG).map((card) => card.id);
    expect(ids).toContain("kessen-kuraokami-kami-of-the-night-snow");
    expect(ids).toContain("kessen-colossus");
  });
});

describe("unlocks", () => {
  const open = (state: KessenCircuitProgress) =>
    KESSEN_NPCS.filter((entry) => unlocked(entry, "standard", state)).map(
      (entry) => entry.key,
    );

  it("opens nothing before the first Academy lesson", () => {
    const fresh = progress({ lessonCompleted: false });
    expect(open(fresh)).toEqual([]);
    expect(npcLockReason(npc("lemu"), "standard", fresh)).toBe(
      "Finish Lemu's first Academy lesson first.",
    );
    expect(open(progress())).toEqual(["lemu"]);
    expect(open(progress({ beaten: ["lemu"] }))).toEqual(["lemu", "kazehiko"]);
  });

  it("opens the home champion first, then the other five", () => {
    const home = progress({ beaten: ["lemu", "kazehiko"], homeFaction: "HYORIN" });
    expect(open(home)).toEqual(["lemu", "kazehiko", "kimiko"]);
    expect(npcLockReason(npc("junko"), "standard", home)).toBe(
      "Beat your home champion.",
    );
    const beat = progress({ ...home, beaten: [...home.beaten, "kimiko"] });
    expect(open(beat)).toEqual(["lemu", "kazehiko", ...championKeys()]);
    const outlaw = progress({ beaten: ["lemu", "kazehiko"], homeFaction: "SYNDICATE" });
    expect(open(outlaw)).toEqual(["lemu", "kazehiko", "ravena"]);
    const unaffiliated = progress({ beaten: ["lemu", "kazehiko"] });
    expect(open(unaffiliated)).toEqual(["lemu", "kazehiko", ...championKeys()]);
  });

  it("gates the Jonin, Kage and Ascended matches on champions", () => {
    const base = ["lemu", "kazehiko"];
    const three = progress({ beaten: [...base, "hisame", "junko", "kimiko"] });
    expect(open(three)).toContain("anbu-chief");
    expect(open(three)).not.toContain("momo");
    expect(npcLockReason(npc("momo"), "standard", three)).toBe(
      "Beat all six village champions.",
    );
    const six = progress({ beaten: [...base, ...championKeys()] });
    expect(open(six)).toContain("momo");
    expect(unlocked(npc("hisame"), "ascended", six)).toBe(true);
    expect(unlocked(npc("hisame"), "ascended", three)).toBe(false);
    expect(unlocked(npc("momo"), "ascended", six)).toBe(false);
    expect(npcLockReason(npc("shishi"), "standard", six)).toBe(
      "Beat Anbu Chief and Momo.",
    );
    const bosses = progress({
      beaten: [...base, ...championKeys(), "anbu-chief", "momo"],
    });
    expect(open(bosses)).toContain("shishi");
    expect(open(bosses)).not.toContain("unmeishi");
    expect(open(progress({ beaten: [...bosses.beaten, "shishi"] }))).toContain(
      "unmeishi",
    );
  });

  it("returns the variant of each mode", () => {
    expect(npcVariant(npc("hisame"), "ascended")).toBe(npc("hisame").ascended);
    expect(npcVariant(npc("hisame"), "standard")).toBe(npc("hisame").standard);
    expect(npcVariant(npc("lemu"), "lesson")).toBeNull();
  });
});

describe("village factions", () => {
  it("maps villages, outlaws and the starter choice", () => {
    expect(villageFaction("Hyorin")).toBe("HYORIN");
    expect(villageFaction("Syndicate")).toBe("SYNDICATE");
    expect(villageFaction("Horizon")).toBeNull();
    expect(villageFaction("Freedom State")).toBeNull();
    expect(villageFaction(null)).toBeNull();
    expect(villageFaction("Horizon", true)).toBe("SYNDICATE");
    expect(homeFaction("Akasumi", false, "HYORIN")).toBe("AKASUMI");
    expect(homeFaction("Horizon", false, "HYORIN")).toBe("HYORIN");
    expect(homeFaction("Horizon", false, "NEUTRAL")).toBeNull();
    expect(homeFaction(undefined, false, null)).toBeNull();
  });

  it("moves Momo between the six villages by day", () => {
    expect(momoFaction("2026-11-15")).toBe(momoFaction("2026-11-15"));
    const seen = new Set(
      Array.from({ length: 30 }, (_, day) => momoFaction(`2026-12-${day + 1}`)),
    );
    expect(seen.size).toBe(6);
  });
});
