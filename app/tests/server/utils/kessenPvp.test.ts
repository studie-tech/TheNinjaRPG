import { describe, expect, it } from "bun:test";
import {
  KESSEN_MIN_MATCH_SECONDS,
  KESSEN_RANKED_DAILY_REWARDED_WINS,
  KESSEN_RANKED_PAIR_DAILY_RATED,
  KESSEN_RANKED_WEEKLY_PACK_WINS,
  KESSEN_RANKED_WIN_RYO,
} from "@/drizzle/constants";
import type { KessenProgress } from "@/drizzle/schema";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { type DuelEnding, planKessenDuelEnd } from "@/server/utils/kessenPvp";
import { getUtcDayKey, periodStart } from "@/utils/time";
import type { KessenStoredPvpMatch } from "@/validators/kessen";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const LONG_AGO = new Date(NOW.getTime() - (KESSEN_MIN_MATCH_SECONDS + 60) * 1000);
const DAY = getUtcDayKey(NOW);
const WEEK = getUtcDayKey(periodStart("weekly", NOW));

const progress = (patch: Partial<KessenProgress> = {}) =>
  ({
    rating: 1000,
    rankedPlayed: 20,
    rankedRewardDay: "",
    rankedRewardsToday: 0,
    rankedWeekKey: "",
    rankedWeeklyWins: 0,
    ...patch,
  }) as KessenProgress;

const plan = (input: {
  kind?: "FRIENDLY" | "RANKED";
  ending?: DuelEnding;
  plays?: [number, number];
  startedAt?: Date;
  progress?: [KessenProgress | null, KessenProgress | null];
  pairRatedToday?: number;
}) =>
  planKessenDuelEnd({
    kind: input.kind ?? "RANKED",
    matchId: "m",
    seatUserIds: ["a", "b"],
    stored: { plays: input.plays ?? [6, 6] } as KessenStoredPvpMatch,
    ending: input.ending ?? { winner: 0, endedBy: "play", loserBy: null },
    startedAt: input.startedAt ?? LONG_AGO,
    now: NOW,
    progress: input.progress ?? [progress(), progress()],
    pairRatedToday: input.pairRatedToday ?? 0,
  });

describe("planKessenDuelEnd", () => {
  it("settles nothing for friendly duels", () => {
    const planned = plan({ kind: "FRIENDLY" });
    expect(planned.settlement).toBeNull();
    expect(planned.result).toMatchObject({ winner: 0, ratings: null, reward: null });
  });

  it("rates both seats and pays an eligible winner", () => {
    const planned = plan({});
    expect(planned.settlement?.ratings).toEqual([
      { before: 1000, after: 1012, delta: 12 },
      { before: 1000, after: 988, delta: -12 },
    ]);
    expect(planned.settlement?.reward).toEqual({
      seat: 0,
      userId: "a",
      ryo: KESSEN_RANKED_WIN_RYO,
      packItemId: null,
    });
    expect(planned.settlement?.objectiveUserId).toBe("a");
    expect(planned.settlement).toMatchObject({ dayKey: DAY, weekKey: WEEK });
  });

  it("adds a Paper Bundle to the win that reaches the weekly count", () => {
    const planned = plan({
      progress: [
        progress({
          rankedWeekKey: WEEK,
          rankedWeeklyWins: KESSEN_RANKED_WEEKLY_PACK_WINS - 1,
        }),
        progress(),
      ],
    });
    expect(planned.settlement?.reward?.packItemId).toBe(KESSEN_PACK_IDS.paper);
  });

  it("rates but does not pay a short concession, a capped winner or a draw", () => {
    const conceded = plan({
      ending: { winner: 1, endedBy: "concede", loserBy: 0 },
      startedAt: NOW,
    });
    expect(conceded.settlement?.ratings?.[1].delta).toBeGreaterThan(0);
    expect(conceded.settlement?.reward).toBeNull();
    expect(conceded.result.note).toBe("The match was too short to be rewarded.");
    expect(conceded.settlement?.objectiveUserId).toBeNull();

    const capped = plan({
      progress: [
        progress({
          rankedRewardDay: DAY,
          rankedRewardsToday: KESSEN_RANKED_DAILY_REWARDED_WINS,
        }),
        progress(),
      ],
    });
    expect(capped.settlement?.reward).toBeNull();
    expect(capped.result.note).toBe(
      "The winner already earned today's ranked rewards.",
    );

    const draw = plan({ ending: { winner: null, endedBy: "timeout", loserBy: null } });
    expect(draw.settlement?.ratings?.map((change) => change.delta)).toEqual([0, 0]);
    expect(draw.settlement?.reward).toBeNull();
  });

  it("leaves a pair's matches past the daily cap unrated", () => {
    const planned = plan({ pairRatedToday: KESSEN_RANKED_PAIR_DAILY_RATED });
    expect(planned.settlement).toBeNull();
    expect(planned.result.ratings).toBeNull();
    expect(planned.result.note).toContain("unrated");
  });
});
