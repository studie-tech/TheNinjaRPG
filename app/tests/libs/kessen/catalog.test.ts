import { describe, expect, it } from "bun:test";
import { terrainSides } from "@/libs/kessen/abilities";
import {
  cardValueMilli,
  catalogFingerprint,
  copyKey,
  itemToKessenCard,
  kessenCardId,
  kessenCardToCardData,
  kessenSlug,
  snapshotCatalog,
  VALUE_PREMIUM_MILLI,
} from "@/libs/kessen/catalog";
import { DEFAULT_KNOBS, TOKEN_CARD_ID } from "@/libs/kessen/rules";
import {
  abilitySegments,
  cardKeywords,
  cardTextPlain,
  KESSEN_GLOSSARY,
  KESSEN_KEYWORDS,
  keywordGlossary,
  terrainReach,
} from "@/libs/kessen/text";
import type { KessenCard } from "@/libs/kessen/types";
import {
  cardDataSchema,
  hiddenChoiceIssue,
  KESSEN_LEADER_ONLY_ABILITIES,
} from "@/validators/itemCard";
import {
  KESSEN_DECK_CARDS,
  KESSEN_FORBIDDEN,
  KESSEN_LEADERS,
  KESSEN_SEED_CATALOG,
  KESSEN_SEED_DISPLAY,
  KESSEN_TOKEN,
  seedCardByName,
} from "./fixtures/catalog";

/** The printed ability text, keyed by card name. */
const PRINTED_TEXT: [string, string][] = [
  ["Taiyo Kami Devotee", "Rally 1"],
  ["Mummy of the Shining Dunes", "Resilient"],
  ["Beta Sandworm", "Summon (Sandworm)"],
  ["Blazing Flash Adept", "Empower 3"],
  ["Fireball", "Strike 5"],
  ["Sand Golem", "Unyielding"],
  ["Gamma Sandworm", "Summon (Sandworm)"],
  ["Subaku Princess", "Bond (Subaku)"],
  ["Subaku Winged Captain", "Bond (Subaku). Rally 1"],
  ["Amaterasu's Holy Mirror", "Empower 3 each unit in one of your rows"],
  ["Amaterasu's Avatar", "Unyielding. Rally 2"],
  ["Moonprowler", "Bond (Moon Pack)"],
  ["Mosswolf", "Meditate 1"],
  ["Tsukihana", "Empower 3"],
  ["Owlcat", "Bond (Moon Pack)"],
  ["Thorn Grasp", "Strike 4"],
  ["Furuki no Seirei", "Revive"],
  ["Moon Shrine Guardian", "Resilient"],
  ["Wood Warrior", "Meditate 1"],
  ["The Cedarback Elder", "Resilient. Meditate 1"],
  ["Demon of Tsuki", "Purge"],
  ["Yasei no Seirei, the Wild Spirit", "Unyielding. Revive"],
  ["Frozen Wraith", "Strike 2"],
  ["Cryverin", "\u2014"],
  ["Hyouga Yui Clansman", "Seal"],
  ["Shimo no Seirei", "Terrain (Taijutsu)"],
  ["Kori no Seirei", "Terrain (Bukijutsu)"],
  ["Byakuho", "Strike 3"],
  ["Ava, the Snow Terror", "Meditate 2"],
  ["Cryostorm Aegis", "Seal each enemy unit in a chosen row"],
  ["Lord Pengu", "Rally 2"],
  ["Yuki Onna", "Seal an enemy unit, then Strike 3 it"],
  [
    "Kuraokami, Kami of the Night Snow",
    "Unyielding. Terrain on the enemy row with the most units",
  ],
  ["Ghost Ship Deckhand", "Summon (Crew)"],
  ["Ghost Ship Gunner", "Summon (Crew)"],
  ["Fist of 10,000 Volts", "Strike 3, then Strike 2"],
  ["Arashima Stormcaller", "\u2014"],
  ["Enrai no Oni", "\u2014"],
  ["Undertide Executioner", "Purge"],
  ["The Salvager", "Revive"],
  ["Mizu no Seirei", "Rally 1"],
  ["Leviathan of the Shroud", "Strike 2 each enemy unit in the opposite row"],
  ["Divine Railgun", "Strike 8"],
  ["The Drowned Gatekeeper", "Unyielding. Summon (Crew)"],
  ["Kugatsunagi", "Clear Skies"],
  ["Kajioka", "\u2014"],
  ["Blazdrift", "Strike 2"],
  ["Sky-Bridge Scout", "Empower 2"],
  ["Wind Release", "Empower 6"],
  ["Yamabiko Echo-Caller", "Empower 2 each other unit in its row"],
  ["Gale Courier", "Infiltrator"],
  ["Typhoon Tear", "Purge a chosen enemy row"],
  ["Aetherion, the Twin Flame", "Strike 3"],
  ["Stormrender, the Storm Cutter", "Clear Skies. Strike 3"],
  ["Fury of the White Tiger", "Unyielding. Strike 2, then Strike 2"],
  ["Thorn Ambusher", "Strike 2"],
  ["Black Maw Acolyte", "Seal"],
  ["Mei Back-Alley Enforcer", "\u2014"],
  ["Mei Cutpurse", "Strike 1 each enemy unit in the opposite row"],
  ["Thousand Scarlet Fangs", "Strike 2 each enemy unit in a chosen row"],
  ["Oblivion Seal Bearer", "Infiltrator"],
  ["Thorn Ambush Captain", "Purge"],
  ["Veylan, Maw of the Pyre", "Strike 2"],
  ["Headless Rider", "Strike 2, then Strike 2"],
  ["Kinjutsu: Black Thorn Rose", "Seal an enemy unit, then Strike 5 it"],
  ["The Caged Sovereign", "Infiltrator. Seal each other unit in the row it joins"],
  ["Kawarimi", "Substitution"],
  ["Seal of Nullification", "Clear Skies"],
  ["Biting Frost", "Terrain (Taijutsu)"],
  ["Howling Gale", "Terrain (Bukijutsu)"],
  ["Torrential Rain", "Terrain (Ninjutsu)"],
  ["Musashi Ken Swordsman", "\u2014"],
  ["Lemu, Academy Instructor", "Rally 1"],
  ["Kazehiko", "Seal"],
  ["Ryouichi, Wake Islander", "Resilient"],
  ["Lotus Barrier", "One of your non-Unyielding units gains Resilient"],
  ["Toto the Baby Dragon", "Meditate 2"],
  ["Anbu Chief", "Seal"],
  ["Colossus", "\u2014"],
  ["Cruel Sun", "Purge each enemy row"],
  ["Shishi, God of Death", "Unyielding. Purge each enemy row"],
  ["Kuzenbo, the Mountain God", "Unyielding. Rally 1"],
  ["Raizhen, the Ten-Tailed", "Unyielding. Strike 1 each enemy unit"],
  ["Aurex, the Imperial Wyrm", "Unyielding. Meditate 2"],
];

/** Board-dependent tech cards, tuned by played win rate instead of the value curve. */
const TECH_CARDS = [
  "Kawarimi",
  "Seal of Nullification",
  "Biting Frost",
  "Howling Gale",
  "Torrential Rain",
  "Lotus Barrier",
  "Cryostorm Aegis",
  "Kugatsunagi",
];

const countBy = <T>(items: T[], key: (item: T) => string) => {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
};

describe("seed catalog", () => {
  it("holds 84 deck cards with the designed rarity split per faction", () => {
    expect(KESSEN_DECK_CARDS).toHaveLength(84);
    expect(countBy(KESSEN_DECK_CARDS, (card) => card.rarity)).toEqual({
      COMMON: 36,
      RARE: 23,
      EPIC: 15,
      LEGENDARY: 10,
    });
    for (const faction of [
      "SHIROHANA",
      "TSUKIMORI",
      "HYORIN",
      "AKASUMI",
      "AKIKAZE",
      "SYNDICATE",
    ]) {
      const cards = KESSEN_DECK_CARDS.filter((card) => card.faction === faction);
      expect(countBy(cards, (card) => card.rarity)).toEqual({
        COMMON: 5,
        RARE: 3,
        EPIC: 2,
        LEGENDARY: 1,
      });
    }
    expect(
      countBy(
        KESSEN_DECK_CARDS.filter((card) => card.faction === "NEUTRAL"),
        (card) => card.rarity,
      ),
    ).toEqual({ COMMON: 6, RARE: 5, EPIC: 3, LEGENDARY: 4 });
    expect(
      KESSEN_DECK_CARDS.every((card) => card.kind !== "LEADER" && card.isCollectible),
    ).toBe(true);
  });

  it("has 12 collectible leaders, 2 boss leaders, 10 Forbidden variants and the token", () => {
    expect(KESSEN_LEADERS.filter((card) => card.isCollectible)).toHaveLength(12);
    expect(
      KESSEN_LEADERS.filter((card) => !card.isCollectible).map((card) => card.name),
    ).toEqual(["Divine Shishi", "The Loom of Fate"]);
    expect(
      countBy(
        KESSEN_LEADERS.filter((card) => card.isCollectible),
        (card) => card.faction,
      ),
    ).toEqual({
      SHIROHANA: 2,
      TSUKIMORI: 2,
      HYORIN: 2,
      AKASUMI: 2,
      AKIKAZE: 2,
      SYNDICATE: 2,
    });
    for (const leader of KESSEN_LEADERS) {
      expect(leader).toMatchObject({
        kind: "LEADER",
        row: null,
        power: 0,
        provision: 0,
      });
      expect(leader.leaderBonus).toBeGreaterThanOrEqual(10);
      expect(leader.abilities.length).toBeGreaterThan(0);
    }
    expect(KESSEN_FORBIDDEN).toHaveLength(10);
    expect(KESSEN_TOKEN).toMatchObject({
      id: TOKEN_CARD_ID,
      kind: "UNIT",
      row: "ANY",
      power: DEFAULT_KNOBS.gambitPower,
      isCollectible: false,
    });
    expect(KESSEN_SEED_CATALOG).toHaveLength(84 + 14 + 10 + 1);
  });

  it("uses unique, readable seed ids", () => {
    const ids = KESSEN_SEED_CATALOG.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(seedCardByName("Moonprowler").id).toBe("kessen-moonprowler");
    expect(seedCardByName("Fist of 10,000 Volts").id).toBe(
      "kessen-fist-of-10000-volts",
    );
    expect(seedCardByName("Amaterasu's Holy Mirror").id).toBe(
      "kessen-amaterasus-holy-mirror",
    );
    expect(seedCardByName("Hisame, Dune Warden").id).toBe(
      "kessen-leader-hisame-dune-warden",
    );
    expect(seedCardByName("Divine Shishi").id).toBe("kessen-leader-divine-shishi");
    expect(KESSEN_FORBIDDEN[0]?.id).toBe("kessen-forbidden-amaterasus-avatar");
    expect(kessenSlug("Kinjutsu: Black Thorn Rose")).toBe("kinjutsu-black-thorn-rose");
    expect(kessenCardId("Shadow Clone", "token")).toBe(TOKEN_CARD_ID);
    for (const card of KESSEN_SEED_CATALOG) {
      expect(card.id).toMatch(
        /^kessen-(leader-|forbidden-|token-)?[a-z0-9]+(-[a-z0-9]+)*$/,
      );
      expect(KESSEN_SEED_DISPLAY[card.id]).toBeDefined();
    }
  });

  it("rejects a choice that would depend on cards a Summon, Revive or Draw reveals", () => {
    const unit = (abilities: unknown[]) =>
      cardDataSchema.safeParse({
        kind: "UNIT",
        faction: "AKASUMI",
        row: "CLOSE",
        power: 3,
        provision: 6,
        abilities,
      }).success;
    const leader = (abilities: unknown[]) =>
      cardDataSchema.safeParse({
        kind: "LEADER",
        faction: "AKASUMI",
        row: null,
        power: 0,
        provision: 0,
        abilities,
      }).success;
    const summon = { k: "summon", group: "Crew" };
    expect(unit([summon, { k: "empower", x: 2, mode: "single" }])).toBe(false);
    expect(unit([summon, { k: "empower", x: 2, mode: "chosenRow" }])).toBe(false);
    expect(unit([summon, { k: "seal", mode: "single" }])).toBe(false);
    expect(unit([summon, { k: "substitution" }])).toBe(false);
    expect(leader([{ k: "revive" }, { k: "grantResilient" }])).toBe(false);
    expect(
      leader([
        { k: "draw", x: 1 },
        { k: "cycle", x: 1 },
      ]),
    ).toBe(false);
    expect(leader([{ k: "allHands" }, { k: "fence" }])).toBe(false);
    expect(unit([{ k: "infiltrator" }, { k: "empower", x: 2, mode: "single" }])).toBe(
      true,
    );
    // Choices among enemy units and rows do not depend on your own reveals.
    expect(unit([summon, { k: "strike", x: 2, mode: "single" }])).toBe(true);
    expect(
      unit([
        summon,
        { k: "seal", mode: "single" },
        { k: "strike", x: 2, mode: "single", sameTarget: true },
      ]),
    ).toBe(true);
    expect(
      leader([
        { k: "cycle", x: 1 },
        { k: "draw", x: 1 },
      ]),
    ).toBe(true);
    expect(unit([{ k: "empower", x: 2, mode: "single" }, summon])).toBe(true);
    for (const card of KESSEN_SEED_CATALOG) {
      expect({ card: card.name, issue: hiddenChoiceIssue(card.abilities) }).toEqual({
        card: card.name,
        issue: null,
      });
    }
  });

  it("parses every card through cardDataSchema and round-trips it from an item row", () => {
    for (const card of KESSEN_SEED_CATALOG) {
      const display = KESSEN_SEED_DISPLAY[card.id];
      const data = kessenCardToCardData(card, {
        flavor: display?.flavor,
        artUrl: "",
      });
      const parsed = cardDataSchema.safeParse(data);
      if (!parsed.success) throw new Error(`${card.name}: ${parsed.error.message}`);
      expect(
        itemToKessenCard({
          id: card.id,
          name: card.name,
          rarity: card.rarity,
          cardData: data,
        }),
      ).toEqual(card);
    }
    expect(
      itemToKessenCard({ id: "x", name: "x", rarity: "COMMON", cardData: null }),
    ).toBeNull();
    expect(
      itemToKessenCard({
        id: "x",
        name: "x",
        rarity: "COMMON",
        cardData: { kind: "UNIT" },
      }),
    ).toBeNull();
  });

  it("keeps leader-only verbs on leaders", () => {
    const leaderOnly = new Set<string>(KESSEN_LEADER_ONLY_ABILITIES);
    for (const card of [...KESSEN_DECK_CARDS, ...KESSEN_FORBIDDEN, KESSEN_TOKEN]) {
      expect(card.abilities.filter((ability) => leaderOnly.has(ability.k))).toEqual([]);
    }
  });

  it("caps keywords per rarity: COMMON and RARE one, EPIC and LEGENDARY two", () => {
    for (const card of [...KESSEN_DECK_CARDS, ...KESSEN_FORBIDDEN]) {
      const limit = card.rarity === "COMMON" || card.rarity === "RARE" ? 1 : 2;
      const count = cardKeywords(card.abilities).length;
      expect({ name: card.name, overLimit: count > limit }).toEqual({
        name: card.name,
        overLimit: false,
      });
    }
    expect(cardKeywords(seedCardByName("Fist of 10,000 Volts").abilities)).toEqual([
      "Strike",
    ]);
    expect(cardKeywords(seedCardByName("Yuki Onna").abilities)).toEqual([
      "Seal",
      "Strike",
    ]);
    expect(cardKeywords(seedCardByName("Lotus Barrier").abilities)).toEqual([
      "Resilient",
    ]);
  });

  it("never prints Unyielding and Resilient on one card", () => {
    for (const card of KESSEN_DECK_CARDS) {
      const kinds = card.abilities.map((ability) => ability.k);
      expect(kinds.includes("unyielding") && kinds.includes("resilient")).toBe(false);
    }
  });

  it("defines the summon groups by membership", () => {
    const members = (group: string) =>
      KESSEN_DECK_CARDS.filter((card) => card.summonGroups.includes(group)).map(
        (card) => card.name,
      );
    expect(members("Sandworm")).toEqual(["Beta Sandworm", "Gamma Sandworm"]);
    expect(members("Crew")).toEqual(["Ghost Ship Deckhand", "Ghost Ship Gunner"]);
  });

  it("mirrors every legendary in a Forbidden variant with identical stats", () => {
    const legendaries = KESSEN_DECK_CARDS.filter((card) => card.rarity === "LEGENDARY");
    expect(KESSEN_FORBIDDEN.map((card) => card.baseCardId).sort()).toEqual(
      legendaries.map((card) => card.id).sort(),
    );
    for (const variant of KESSEN_FORBIDDEN) {
      const base = KESSEN_DECK_CARDS.find((card) => card.id === variant.baseCardId);
      if (!base) throw new Error(`No base for ${variant.name}`);
      const restored: KessenCard = {
        ...variant,
        id: base.id,
        name: base.name,
        variant: "STANDARD",
        baseCardId: null,
      };
      expect(restored).toEqual(base);
      expect(copyKey(variant)).toBe(copyKey(base));
      expect(variant.variant).toBe("FORBIDDEN");
    }
  });

  it("puts every non-tech card within 1.5 points of its value curve target", () => {
    let checked = 0;
    for (const card of KESSEN_DECK_CARDS) {
      const value = cardValueMilli(card);
      if (value === null || TECH_CARDS.includes(card.name)) continue;
      const target = card.provision * 1000 + VALUE_PREMIUM_MILLI[card.rarity];
      expect({ name: card.name, within: Math.abs(value - target) <= 1500 }).toEqual({
        name: card.name,
        within: true,
      });
      checked++;
    }
    expect(checked).toBe(73);
    expect(cardValueMilli(seedCardByName("Gale Courier"))).toBeNull();
  });

  it("fingerprints the engine fields of the catalog", () => {
    const fingerprint = catalogFingerprint(KESSEN_SEED_CATALOG);
    expect(catalogFingerprint([...KESSEN_SEED_CATALOG].reverse())).toBe(fingerprint);
    const changed = KESSEN_SEED_CATALOG.map((card) =>
      card.name === "Colossus" ? { ...card, power: 13 } : card,
    );
    expect(catalogFingerprint(changed)).not.toBe(fingerprint);
    expect(
      snapshotCatalog(KESSEN_SEED_CATALOG, ["kessen-colossus", "kessen-cryverin"]).map(
        (card) => card.id,
      ),
    ).toEqual(["kessen-colossus", "kessen-cryverin"]);
  });
});

describe("card text", () => {
  it("names the one-sided Terrain of Hyorin's Permafrost", () => {
    const plain = (name: string) =>
      abilitySegments(seedCardByName(name).abilities, "enemy")
        .map((segment) => segment.s)
        .join("");
    expect(plain("Shimo no Seirei")).toBe("Terrain (enemy Taijutsu)");
    expect(plain("Kimiko, Frost Warden")).toBe("Terrain on a chosen enemy row");
    expect(plain("Biting Frost")).toBe("Terrain (enemy Taijutsu)");
    expect(cardTextPlain(seedCardByName("Shimo no Seirei"))).toBe("Terrain (Taijutsu)");
    expect(keywordGlossary("Terrain")).toBe(KESSEN_GLOSSARY.Terrain);
    expect(keywordGlossary("Terrain", "enemy")).toStartWith(
      "Permafrost: afflicts only the enemy's row",
    );
    expect(keywordGlossary("Strike", "enemy")).toBe(KESSEN_GLOSSARY.Strike);
  });

  it("derives Terrain reach from the same rule as the engine", () => {
    expect(terrainReach("HYORIN")).toBe("enemy");
    expect(terrainReach("AKASUMI")).toBe("both");
    expect(terrainReach(null)).toBe("both");
    const knobs = { ...DEFAULT_KNOBS, permafrostR3: false };
    expect(terrainReach("HYORIN", { round: 2, knobs })).toBe("enemy");
    expect(terrainReach("HYORIN", { round: 3, knobs })).toBe("both");
    expect(terrainReach("HYORIN", { knobs: { ...knobs, permafrost: false } })).toBe(
      "both",
    );
    for (const round of [1, 2, 3])
      for (const variant of [DEFAULT_KNOBS, knobs]) {
        const view = {
          round,
          knobs: variant,
          seats: [{ faction: "HYORIN" as const }, { faction: "TSUKIMORI" as const }],
        };
        expect(terrainSides(view, 0).length === 1).toBe(
          terrainReach("HYORIN", view) === "enemy",
        );
        expect(terrainSides(view, 1)).toEqual([0, 1]);
      }
  });

  it("prints the designed ability text for every deck card", () => {
    expect(PRINTED_TEXT).toHaveLength(84);
    for (const [name, printed] of PRINTED_TEXT) {
      expect({ name, text: cardTextPlain(seedCardByName(name)) }).toEqual({
        name,
        text: printed,
      });
    }
  });

  it("writes out the leader abilities", () => {
    const text = (name: string) => cardTextPlain(seedCardByName(name));
    expect(text("Hisame, Dune Warden")).toBe("Empower 3 each unit in one of your rows");
    expect(text("Subaku Demon Lord")).toBe("Strike 5");
    expect(text("Kimiko, Frost Warden")).toBe("Terrain on a chosen row");
    expect(text("Frost Sovereign")).toBe(
      "Seal an enemy unit, then Strike 5 it, then Strike 4",
    );
    expect(text("The Hollow Conductor")).toBe(
      "Empower 1 each unit in one of your rows",
    );
    expect(text("Kaze no Seirei")).toBe(
      "Substitution, then Empower 2 another of your units",
    );
    expect(text("Ravena Bloodsilk")).toBe("Strike 4");
    expect(
      cardTextPlain({
        abilities: [
          { k: "strike", x: 4, mode: "single" },
          { k: "draw", x: 1, ifKilled: true },
        ],
      }),
    ).toBe("Strike 4; if the target is destroyed, draw 1");
    expect(text("Divine Shishi")).toBe("Revive, then Revive again");
    expect(text("Aerathiel Wind-Bearer")).toBe(
      "Choose up to 2 cards in your hand, put them on the bottom of your deck, then draw that many plus 1",
    );
    expect(text("Amir, the Hoarder")).toContain(
      "from the opponent's discard to your side",
    );
  });

  it("marks keyword segments for colouring and escapes HTML", () => {
    expect(abilitySegments(seedCardByName("Yuki Onna").abilities)).toEqual([
      { t: "kw", kw: "Seal", s: "Seal" },
      { t: "text", s: " an enemy unit, then " },
      { t: "kw", kw: "Strike", s: "Strike 3" },
      { t: "text", s: " it" },
    ]);
    expect(cardTextPlain(seedCardByName("Lotus Barrier"))).toContain(
      "One of your non-Unyielding units gains ",
    );
  });

  it("states when Terrain is illegal and when it fizzles", () => {
    expect(KESSEN_GLOSSARY.Terrain).toContain(
      "A tactic or leader that would afflict nothing new cannot be played; on a unit it fizzles.",
    );
  });

  it("has a one-line glossary entry for each of the 15 keywords", () => {
    expect(KESSEN_KEYWORDS).toHaveLength(15);
    for (const keyword of KESSEN_KEYWORDS) {
      expect(KESSEN_GLOSSARY[keyword].length).toBeGreaterThan(10);
      expect(KESSEN_GLOSSARY[keyword]).not.toContain("\n");
    }
  });
});
