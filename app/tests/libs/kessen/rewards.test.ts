import { describe, expect, it } from "bun:test";
import {
  KESSEN_DAILY_DROP_ROLLS,
  KESSEN_DAILY_REWARDED_MATCHES,
  KESSEN_MATCH_LOSS_RYO,
  KESSEN_MATCH_WIN_RYO,
} from "@/drizzle/constants";
import { catalogById } from "@/libs/kessen/deck";
import {
  type KessenNpcKey,
  kessenNpc,
  npcDropPool,
  npcForbiddenPool,
} from "@/libs/kessen/npcs";
import {
  KESSEN_PACK_IDS,
  kessenPackName,
  kessenVillagePackFaction,
} from "@/libs/kessen/packs";
import {
  BASIS_POINTS,
  copiesByName,
  countPlays,
  dailyCountersFor,
  dupeProtectedPick,
  firstWinEarned,
  isMaxed,
  KESSEN_DROP_TABLES,
  type KessenDailyCounters,
  matchRyo,
  outcomeFor,
  type PayoutInput,
  planMatchPayout,
  rewardEligibility,
  rollNpcDrop,
  selectWeighted,
  unownedLegendaries,
  weeklyWinsFor,
} from "@/libs/kessen/rewards";
import { createRng } from "@/libs/kessen/rng";
import type { KessenCard, KessenEvent } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG, seedCardByName } from "./fixtures/catalog";

const CATALOG = catalogById(KESSEN_SEED_CATALOG);
const cid = (name: string) => seedCardByName(name).id;
const pool = (key: KessenNpcKey) =>
  npcDropPool(
    kessenNpc(key) as NonNullable<ReturnType<typeof kessenNpc>>,
    KESSEN_SEED_CATALOG,
  );

describe("selectWeighted", () => {
  it("draws integer weights proportionally and deterministically", () => {
    const rng = createRng("weights");
    const counts = { a: 0, b: 0, c: 0 };
    for (let n = 0; n < 20000; n++) {
      const key = selectWeighted({ a: 1, b: 3, c: 0 }, ["a", "b", "c"], rng);
      if (key) counts[key] += 1;
    }
    expect(counts.c).toBe(0);
    expect(counts.a + counts.b).toBe(20000);
    expect(counts.b / counts.a).toBeGreaterThan(2.7);
    expect(counts.b / counts.a).toBeLessThan(3.3);
    const again = createRng("weights");
    const first = createRng("weights");
    expect(selectWeighted({ a: 1, b: 3 }, ["a", "b"], again)).toBe(
      selectWeighted({ a: 1, b: 3 }, ["a", "b"], first),
    );
  });

  it("returns null when every weight is zero", () => {
    expect(selectWeighted({ a: 0 }, ["a"], createRng("x"))).toBeNull();
    expect(selectWeighted({}, ["a"], createRng("x"))).toBeNull();
  });
});

describe("drop tables", () => {
  it("weigh rarities in basis points", () => {
    for (const table of Object.values(KESSEN_DROP_TABLES)) {
      const total = Object.values(table.rarityBp).reduce(
        (sum, value) => sum + value,
        0,
      );
      expect(total).toBe(BASIS_POINTS);
    }
    expect(KESSEN_DROP_TABLES.NOVICE.cardBp).toBe(2500);
    // Effective legendary rate per Adept win: 0.15% of BASIS_POINTS squared.
    expect(
      KESSEN_DROP_TABLES.ADEPT.rarityBp.LEGENDARY * KESSEN_DROP_TABLES.ADEPT.cardBp,
    ).toBe(150_000);
    expect(KESSEN_DROP_TABLES.KAGE.forbiddenBp).toBe(10);
  });

  it("rolls the card chance and rarity split over many wins", () => {
    const byName = new Map<string, number>();
    const tally = { drops: 0, COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };
    const runs = 20000;
    for (let n = 0; n < runs; n++) {
      const result = rollNpcDrop({
        seed: `kessen-drop:m${n}`,
        table: "MASTER",
        pool: pool("anbu-chief"),
        byName,
      });
      if (result.card) {
        tally.drops += 1;
        tally[result.card.card.rarity] += 1;
        expect(result.rarity).toBe(result.card.card.rarity);
      }
      expect(result.forbidden).toBeNull();
    }
    expect(tally.drops / runs).toBeGreaterThan(0.33);
    expect(tally.drops / runs).toBeLessThan(0.37);
    expect(tally.COMMON / tally.drops).toBeGreaterThan(0.49);
    expect(tally.COMMON / tally.drops).toBeLessThan(0.55);
    expect(tally.EPIC / tally.drops).toBeGreaterThan(0.11);
    expect(tally.LEGENDARY).toBeGreaterThan(30);
    expect(tally.LEGENDARY).toBeLessThan(120);
  });

  it("is deterministic per seed and only picks the NPC's own cards", () => {
    const byName = new Map<string, number>();
    const input = {
      seed: "kessen-drop:x",
      table: "KAGE" as const,
      pool: pool("shishi"),
      byName,
    };
    expect(rollNpcDrop(input)).toEqual(rollNpcDrop(input));
    const ids = new Set(pool("shishi").map((card) => card.id));
    for (let n = 0; n < 500; n++) {
      const result = rollNpcDrop({ ...input, seed: `s${n}` });
      if (result.card) expect(ids.has(result.card.card.id)).toBe(true);
    }
  });

  it("downgrades to the next rarity the pool holds", () => {
    const commonsOnly = pool("lemu").filter((card) => card.rarity === "COMMON");
    for (let n = 0; n < 300; n++) {
      const result = rollNpcDrop({
        seed: `d${n}`,
        table: "KAGE",
        pool: commonsOnly,
        byName: new Map(),
      });
      if (result.card) expect(result.card.card.rarity).toBe("COMMON");
    }
  });

  it("rolls Forbidden variants only on Kage tables", () => {
    const shishi = kessenNpc("shishi") as NonNullable<ReturnType<typeof kessenNpc>>;
    const forbiddenPool = npcForbiddenPool(shishi, KESSEN_SEED_CATALOG);
    let hits = 0;
    for (let n = 0; n < 50000; n++) {
      const result = rollNpcDrop({
        seed: `f${n}`,
        table: "KAGE",
        pool: pool("shishi"),
        forbiddenPool,
        byName: new Map(),
      });
      if (result.forbidden) {
        hits += 1;
        expect(result.forbidden.id).toBe("kessen-forbidden-shishi-god-of-death");
      }
    }
    expect(hits).toBeGreaterThan(20);
    expect(hits).toBeLessThan(90);
    const master = rollNpcDrop({
      seed: "f1",
      table: "MASTER",
      pool: pool("momo"),
      forbiddenPool,
      byName: new Map(),
    });
    expect(master.forbidden).toBeNull();
  });
});

describe("dupe protection", () => {
  const commons = ["Cryverin", "Frozen Wraith", "Hyouga Yui Clansman"].map(
    (name) => CATALOG[cid(name)] as KessenCard,
  );

  it("counts copies by name with Forbidden variants as their base", () => {
    const byName = copiesByName(
      {
        "kessen-raizhen-the-ten-tailed": 0,
        "kessen-forbidden-raizhen-the-ten-tailed": 1,
        [cid("Cryverin")]: 3,
      },
      KESSEN_SEED_CATALOG,
    );
    expect(byName.get("kessen-raizhen-the-ten-tailed")).toBe(1);
    expect(
      isMaxed(CATALOG["kessen-raizhen-the-ten-tailed"] as KessenCard, byName),
    ).toBe(true);
    expect(isMaxed(commons[0] as KessenCard, byName)).toBe(true);
    expect(isMaxed(commons[1] as KessenCard, byName)).toBe(false);
  });

  it("re-rolls a maxed pick among non-maxed cards, else grants surplus", () => {
    const maxed = copiesByName(
      { [cid("Cryverin")]: 3, [cid("Frozen Wraith")]: 3 },
      KESSEN_SEED_CATALOG,
    );
    let rerolled = 0;
    for (let n = 0; n < 200; n++) {
      const pick = dupeProtectedPick(createRng(`p${n}`), commons, maxed);
      expect(pick?.card.id).toBe(cid("Hyouga Yui Clansman"));
      expect(pick?.surplus).toBe(false);
      if (pick?.rerolled) rerolled += 1;
    }
    expect(rerolled).toBeGreaterThan(100);
    const all = copiesByName(
      Object.fromEntries(commons.map((card) => [card.id, 3])),
      KESSEN_SEED_CATALOG,
    );
    const surplus = dupeProtectedPick(createRng("s"), commons, all);
    expect(surplus).toMatchObject({ rerolled: false, surplus: true });
    expect(dupeProtectedPick(createRng("s"), [], all)).toBeNull();
  });

  it("applies to NPC drops", () => {
    const owned = Object.fromEntries(
      pool("lemu")
        .filter((card) => card.rarity === "COMMON" && card.id !== cid("Enrai no Oni"))
        .map((card) => [card.id, 3]),
    );
    const byName = copiesByName(owned, KESSEN_SEED_CATALOG);
    for (let n = 0; n < 400; n++) {
      const result = rollNpcDrop({
        seed: `l${n}`,
        table: "NOVICE",
        pool: pool("lemu"),
        byName,
      });
      if (result.card?.card.rarity === "COMMON") {
        expect(result.card.card.id).toBe(cid("Enrai no Oni"));
      }
    }
  });

  it("lists unowned standard legendaries", () => {
    const owned = {
      "kessen-forbidden-raizhen-the-ten-tailed": 1,
      "kessen-colossus": 1,
      "kessen-aurex-the-imperial-wyrm": 1,
    };
    const ids = unownedLegendaries(KESSEN_SEED_CATALOG, owned).map((card) => card.id);
    expect(ids.length).toBe(8);
    expect(ids).not.toContain("kessen-raizhen-the-ten-tailed");
    expect(ids).not.toContain("kessen-aurex-the-imperial-wyrm");
    expect(ids.every((id) => !id.startsWith("kessen-forbidden-"))).toBe(true);
  });
});

describe("eligibility", () => {
  const base = {
    outcome: "loss" as const,
    endedBy: "play" as const,
    durationMs: 90_000,
    plays: [4, 4] as const,
  };

  it("needs play to the end, 90 s, 8 plays and 4 own plays on a loss", () => {
    expect(rewardEligibility(base)).toEqual({ eligible: true });
    expect(rewardEligibility({ ...base, endedBy: "concede" }).eligible).toBe(false);
    expect(rewardEligibility({ ...base, endedBy: "expire" }).eligible).toBe(false);
    expect(rewardEligibility({ ...base, durationMs: 89_999 }).eligible).toBe(false);
    expect(rewardEligibility({ ...base, plays: [4, 3] }).eligible).toBe(false);
    expect(rewardEligibility({ ...base, plays: [3, 6] }).eligible).toBe(false);
    expect(
      rewardEligibility({ ...base, outcome: "draw", plays: [3, 6] }).eligible,
    ).toBe(false);
    expect(rewardEligibility({ ...base, outcome: "win", plays: [2, 6] })).toEqual({
      eligible: true,
    });
  });

  it("counts card plays per seat without tokens", () => {
    const events: KessenEvent[] = [
      { t: "played", seat: 0, id: "s0-1", cardId: "a" },
      { t: "played", seat: 0, id: "t-1", cardId: "kessen-token-shadow-clone" },
      { t: "played", seat: 1, id: "s1-1", cardId: "b" },
      { t: "passed", seat: 0, auto: false },
      { t: "played", seat: 1, id: "s1-2", cardId: "c" },
    ];
    expect(countPlays(events)).toEqual([1, 2]);
  });

  it("maps the engine winner to the human's outcome", () => {
    expect(outcomeFor(0)).toBe("win");
    expect(outcomeFor(1)).toBe("loss");
    expect(outcomeFor(null)).toBe("draw");
    expect(outcomeFor(1, 1)).toBe("win");
    expect(firstWinEarned("win", "play")).toBe(true);
    expect(firstWinEarned("win", "concede")).toBe(false);
    expect(firstWinEarned("draw", "play")).toBe(false);
  });
});

describe("ryo and daily caps", () => {
  it("pays the tier table with per-NPC diminishing wins", () => {
    expect(matchRyo("GENIN", "win", 1)).toBe(KESSEN_MATCH_WIN_RYO.GENIN);
    expect(matchRyo("KAGE", "win", 4)).toBe(KESSEN_MATCH_WIN_RYO.KAGE);
    expect(matchRyo("CHUNIN", "win", 5)).toBe(KESSEN_MATCH_WIN_RYO.CHUNIN / 2);
    expect(matchRyo("JONIN", "win", 6)).toBe(KESSEN_MATCH_WIN_RYO.JONIN / 2);
    expect(matchRyo("JONIN", "win", 7)).toBe(0);
    expect(matchRyo("JONIN", "loss", 9)).toBe(KESSEN_MATCH_LOSS_RYO.JONIN);
    expect(matchRyo("KAGE", "draw", 0)).toBe(KESSEN_MATCH_LOSS_RYO.KAGE);
  });

  const payout = (over: Partial<PayoutInput> = {}) =>
    planMatchPayout({
      counters: null,
      dayKey: "2026-11-15",
      npcKey: "kimiko",
      tier: "CHUNIN",
      outcome: "win",
      eligibility: { eligible: true },
      weeklyWins: 0,
      ...over,
    });

  it("rolls counters over by day", () => {
    const stale: KessenDailyCounters = {
      dayKey: "2026-11-14",
      rewarded: 12,
      drops: 5,
      npcWins: { kimiko: 9 },
    };
    expect(dailyCountersFor(stale, "2026-11-15")).toEqual({
      dayKey: "2026-11-15",
      rewarded: 0,
      drops: 0,
      npcWins: {},
    });
    expect(dailyCountersFor(stale, "2026-11-14")).toBe(stale);
    expect(payout({ counters: stale })).toMatchObject({
      rewarded: true,
      ryo: KESSEN_MATCH_WIN_RYO.CHUNIN,
      dropRoll: true,
      weeklyFirstWin: true,
      counters: { dayKey: "2026-11-15", rewarded: 1, drops: 1, npcWins: { kimiko: 1 } },
    });
  });

  it("caps rewarded matches, drop rolls and the weekly first win", () => {
    let counters: KessenDailyCounters | null = null;
    let weeklyWins = 0;
    let drops = 0;
    let firstWins = 0;
    let ryo = 0;
    for (let n = 0; n < 15; n++) {
      const plan = payout({ counters, weeklyWins });
      counters = plan.counters;
      if (plan.dropRoll) drops += 1;
      if (plan.weeklyFirstWin) firstWins += 1;
      if (plan.rewarded) weeklyWins += 1;
      ryo += plan.ryo;
      if (n >= KESSEN_DAILY_REWARDED_MATCHES) {
        expect(plan).toMatchObject({ rewarded: false, ryo: 0, dropRoll: false });
      }
    }
    const win = KESSEN_MATCH_WIN_RYO.CHUNIN;
    expect(drops).toBe(KESSEN_DAILY_DROP_ROLLS);
    expect(firstWins).toBe(1);
    expect(ryo).toBe(4 * win + 2 * (win / 2));
    expect(counters?.rewarded).toBe(KESSEN_DAILY_REWARDED_MATCHES);
    expect(counters?.npcWins.kimiko).toBe(KESSEN_DAILY_REWARDED_MATCHES);
  });

  it("pays losses without drops and keeps per-NPC counts apart", () => {
    const loss = payout({ outcome: "loss" });
    expect(loss).toMatchObject({
      rewarded: true,
      ryo: KESSEN_MATCH_LOSS_RYO.CHUNIN,
      dropRoll: false,
      weeklyFirstWin: false,
      counters: { rewarded: 1, drops: 0, npcWins: {} },
    });
    const other = payout({
      counters: { dayKey: "2026-11-15", rewarded: 3, drops: 3, npcWins: { kimiko: 6 } },
      npcKey: "junko",
    });
    expect(other.ryo).toBe(KESSEN_MATCH_WIN_RYO.CHUNIN);
    expect(other.counters.npcWins).toEqual({ kimiko: 6, junko: 1 });
  });

  it("pays nothing for ineligible matches and lessons", () => {
    const counters = { dayKey: "2026-11-15", rewarded: 2, drops: 1, npcWins: {} };
    const ineligible = payout({
      counters,
      eligibility: { eligible: false, reason: "too short" },
    });
    expect(ineligible).toEqual({
      rewarded: false,
      reason: "too short",
      ryo: 0,
      dropRoll: false,
      weeklyFirstWin: false,
      counters,
    });
    expect(payout({ lesson: true }).rewarded).toBe(false);
  });
});

describe("the weekly first-win pack", () => {
  it("counts only this week's rewarded wins", () => {
    const stored = { weekKey: "2026-11-09", weeklyWins: 4 };
    expect(weeklyWinsFor(stored, "2026-11-09")).toBe(4);
    expect(weeklyWinsFor(stored, "2026-11-16")).toBe(0);
    expect(weeklyWinsFor(null, "2026-11-16")).toBe(0);
  });

  it("grants the pack on the week's first rewarded win only", () => {
    const plan = (weeklyWins: number, outcome: "win" | "loss" = "win") =>
      planMatchPayout({
        counters: null,
        dayKey: "2026-11-16",
        npcKey: "kimiko",
        tier: "GENIN",
        outcome,
        eligibility: { eligible: true },
        weeklyWins,
      }).weeklyFirstWin;
    expect(plan(0)).toBe(true);
    expect(plan(1)).toBe(false);
    expect(plan(0, "loss")).toBe(false);
  });
});

describe("pack ids", () => {
  it("follow the contract naming", () => {
    expect(KESSEN_PACK_IDS.paper).toBe("kessen-pack-paper");
    expect(KESSEN_PACK_IDS.lacquer).toBe("kessen-pack-lacquer");
    expect(KESSEN_PACK_IDS.village("AKIKAZE")).toBe("kessen-pack-village-akikaze");
  });

  it("names every pack and maps Village Bundles back to their faction", () => {
    expect(kessenPackName(KESSEN_PACK_IDS.first)).toBe("First Bundle");
    expect(kessenPackName(KESSEN_PACK_IDS.village("HYORIN"))).toBe(
      "Hyorin Village Bundle",
    );
    expect(kessenPackName("kessen-moonprowler")).toBeNull();
    expect(kessenVillagePackFaction(KESSEN_PACK_IDS.village("SYNDICATE"))).toBe(
      "SYNDICATE",
    );
    expect(kessenVillagePackFaction(KESSEN_PACK_IDS.paper)).toBeNull();
  });
});
