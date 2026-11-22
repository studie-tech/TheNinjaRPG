import { describe, expect, it } from "bun:test";
import {
  getKessenHubAfterClaim,
  getKessenHubAfterEnd,
  getKessenHubAfterStart,
  getKessenHubAfterTurn,
  getKessenHubWithGrants,
  getKessenMatchCache,
  getKessenMatchLog,
  getKessenPayoutUserUpdate,
  kessenEndNeedsHubRefresh,
  kessenPendingPickOf,
  kessenResultGrantsItems,
} from "@/deltas/kessen";
import type {
  KessenEvent,
  KessenHub,
  KessenMatchPayload,
  KessenMatchResult,
} from "@/validators/kessen";

const result = (patch: Partial<KessenMatchResult> = {}): KessenMatchResult => ({
  winner: 0,
  rewarded: true,
  reason: null,
  ryo: 400,
  drops: [],
  firstWin: null,
  weeklyFirstWinPack: true,
  lessonCompleted: false,
  academy: null,
  ...patch,
});

const payload = (patch: Partial<KessenMatchPayload> = {}): KessenMatchPayload =>
  ({
    id: "m1",
    version: 3,
    status: "FINISHED",
    npcKey: "lemu",
    mode: "standard",
    lesson: null,
    tier: "GENIN",
    startedAt: new Date(0),
    view: {} as KessenMatchPayload["view"],
    borrowed: [],
    result: result(),
    ...patch,
  }) as KessenMatchPayload;

/** A view in Round 2 of the player's turn, after the player won Round 1. */
const roundTwoView = (patch: Partial<KessenMatchPayload["view"]> = {}) =>
  ({
    me: 0,
    round: 2,
    phase: "play",
    turn: 0,
    seats: [{ mullPending: false }, { mullPending: false }],
    history: [{ round: 1, totals: [9, 4], winner: 0, riggedOdds: false }],
    ...patch,
  }) as KessenMatchPayload["view"];

const ACTIVE = {
  id: "m1",
  npcKey: "lemu",
  mode: "standard",
  lesson: null,
  challenge: null,
  round: 1,
  roundWins: [0, 0],
  yourTurn: true,
} satisfies KessenHub["activeMatch"];

const hub = (patch: Partial<KessenHub> = {}): KessenHub =>
  ({
    owned: { "kessen-colossus": 1 },
    activeMatch: ACTIVE,
    pendingPicks: [],
    today: { rewarded: 2, rewardedCap: 12, drops: 1, dropsCap: 5 },
    week: { firstWinPack: true },
    ...patch,
  }) as KessenHub;

describe("kessen deltas", () => {
  it("credits paid ryo and nothing for unpaid matches", () => {
    expect(getKessenPayoutUserUpdate(400)).toEqual({ userDelta: { money: 400 } });
    expect(getKessenPayoutUserUpdate(0)).toEqual({});
  });

  it("keeps a newer cached version of the same match", () => {
    const newer = payload({ version: 5 });
    expect(getKessenMatchCache({ match: newer }, payload())).toEqual({ match: newer });
    expect(getKessenMatchCache({ match: payload({ version: 2 }) }, payload())).toEqual({
      match: payload(),
    });
    expect(getKessenMatchCache(undefined, payload())).toEqual({ match: payload() });
  });

  it("names only the instances a play log refers to, skipping redacted ids", () => {
    const events: KessenEvent[] = [
      { t: "drawn", seat: 1, cards: ["?", "?"], banked: 0 },
      { t: "mulligan", seat: 0, count: 1, removed: ["s0-1"], drawn: ["s0-9"] },
      { t: "damaged", id: "s1-4", amount: 2, stored: 3, source: "s0-2" },
      { t: "returned", id: "?", seat: 1, to: "deck", from: "hand" },
      { t: "cleanup", kept: ["s0-2"], discarded: [], banished: [] },
    ];
    const inst = {
      "s0-1": "a",
      "s0-2": "b",
      "s0-9": "c",
      "s1-4": "d",
      "s1-7": "hidden",
    };
    expect(getKessenMatchLog(events, inst, 4)).toEqual({
      version: 4,
      events,
      inst: { "s0-1": "a", "s0-9": "c", "s1-4": "d", "s0-2": "b" },
    });
  });

  it("extends a cached play log in step with the match by a turn's events", () => {
    const before: KessenEvent[] = [{ t: "passed", seat: 1, auto: false }];
    const turn: KessenEvent[] = [
      {
        t: "placed",
        id: "s0-3",
        cardId: "kessen-colossus",
        owner: 0,
        side: 0,
        row: "CLOSE",
        source: "hand",
        stored: 9,
      },
    ];
    const cached = payload({ status: "ACTIVE", version: 3, view: roundTwoView() });
    const confirmed = payload({
      status: "ACTIVE",
      version: 4,
      view: roundTwoView({ inst: { "s0-3": "kessen-colossus" } }),
    });
    const log = { version: 3, events: before, inst: {} };
    expect(getKessenMatchCache({ match: cached, log }, confirmed, turn)).toEqual({
      match: confirmed,
      log: {
        version: 4,
        events: [...before, ...turn],
        inst: { "s0-3": "kessen-colossus" },
      },
    });
    // Without events (a concession or claim) the log keeps the version it reflects.
    expect(getKessenMatchCache({ match: cached, log }, confirmed)).toEqual({
      match: confirmed,
      log,
    });
    // A log behind the cached match cannot take the events in order.
    const behind = { ...log, version: 2 };
    expect(
      getKessenMatchCache({ match: cached, log: behind }, confirmed, turn),
    ).toEqual({ match: confirmed, log: behind });
    // Another match's log is dropped.
    expect(
      getKessenMatchCache(
        { match: cached, log },
        payload({ id: "m2", version: 1 }),
        turn,
      ),
    ).toEqual({ match: payload({ id: "m2", version: 1 }) });
  });

  it("records a started match as active", () => {
    const next = getKessenHubAfterStart(
      hub({ activeMatch: null }),
      payload({
        id: "m2",
        status: "ACTIVE",
        view: roundTwoView({
          round: 1,
          phase: "mulligan",
          history: [],
          seats: [
            { mullPending: true },
            { mullPending: false },
          ] as KessenMatchPayload["view"]["seats"],
        }),
      }),
    );
    expect(next.activeMatch).toEqual({
      id: "m2",
      npcKey: "lemu",
      mode: "standard",
      lesson: null,
      challenge: null,
      round: 1,
      roundWins: [0, 0],
      yourTurn: true,
    });
  });

  it("follows the active match's round, round wins and turn after a turn", () => {
    const base = hub();
    const next = getKessenHubAfterTurn(
      base,
      payload({ status: "ACTIVE", view: roundTwoView() }),
    );
    expect(next.activeMatch).toEqual({ ...ACTIVE, round: 2, roundWins: [1, 0] });
    const tied = getKessenHubAfterTurn(
      base,
      payload({
        status: "ACTIVE",
        view: roundTwoView({
          round: 3,
          turn: 1,
          history: [
            { round: 1, totals: [5, 5], winner: null, riggedOdds: false },
            { round: 2, totals: [3, 8], winner: 1, riggedOdds: false },
          ],
        }),
      }),
    );
    expect(tied.activeMatch).toMatchObject({
      round: 3,
      roundWins: [0, 1],
      yourTurn: false,
    });
    expect(
      getKessenHubAfterTurn(
        base,
        payload({ id: "m9", status: "ACTIVE", view: roundTwoView() }),
      ),
    ).toBe(base);
  });

  it("keeps a first-win pick an ended match leaves open until it is claimed", () => {
    const choice = { kind: "items" as const, options: ["kessen-a", "kessen-b"] };
    const open = payload({
      result: result({
        firstWin: { itemIds: [], choice: { ...choice, claimed: null } },
      }),
    });
    expect(kessenPendingPickOf(open)).toEqual({ matchId: "m1", npcKey: "lemu" });
    expect(
      kessenPendingPickOf(
        payload({
          result: result({
            firstWin: { itemIds: [], choice: { ...choice, claimed: "kessen-a" } },
          }),
        }),
      ),
    ).toBeNull();
    expect(
      kessenPendingPickOf(
        payload({
          result: result({
            firstWin: { itemIds: [], choice: { kind: "starterFaction" } },
          }),
        }),
      ),
    ).toBeNull();
    const ended = getKessenHubAfterEnd(
      hub({ pendingPicks: [{ matchId: "m0", npcKey: "kazehiko" }] }),
      open,
      [],
    );
    expect(ended.pendingPicks).toEqual([
      { matchId: "m1", npcKey: "lemu" },
      { matchId: "m0", npcKey: "kazehiko" },
    ]);
    const claimed = getKessenHubAfterClaim(ended, "m1", [
      { itemId: "kessen-a", quantity: 1 },
    ]);
    expect(claimed.pendingPicks).toEqual([{ matchId: "m0", npcKey: "kazehiko" }]);
    expect(claimed.owned["kessen-a"]).toBe(1);
  });

  it("clears the active match and counts a rewarded end", () => {
    const next = getKessenHubAfterEnd(hub(), payload(), [
      { itemId: "kessen-colossus", quantity: 1 },
      { itemId: "kessen-pack-paper", quantity: 1 },
    ]);
    expect(next.activeMatch).toBeNull();
    expect(next.owned).toEqual({ "kessen-colossus": 2 });
    expect(next.today).toMatchObject({ rewarded: 3, drops: 2 });
    expect(next.week).toEqual({ firstWinPack: false });
  });

  it("keeps the weekly pack open after a rewarded loss", () => {
    const next = getKessenHubAfterEnd(
      hub(),
      payload({ result: result({ winner: 1, weeklyFirstWinPack: false }) }),
      [],
    );
    expect(next.today).toMatchObject({ rewarded: 3, drops: 1 });
    expect(next.week).toEqual({ firstWinPack: true });
  });

  it("leaves counters alone for unrewarded ends and other matches active", () => {
    const other = hub({
      activeMatch: { ...ACTIVE, id: "m9", mode: "lesson", lesson: "enough" },
    });
    const next = getKessenHubAfterEnd(
      other,
      payload({ result: result({ rewarded: false, ryo: 0 }) }),
      [],
    );
    expect(next.activeMatch?.id).toBe("m9");
    expect(next.today).toBe(other.today);
    expect(next.week).toBe(other.week);
  });

  it("adds grants without touching an unchanged hub", () => {
    const base = hub();
    expect(getKessenHubWithGrants(base, [])).toBe(base);
    expect(
      getKessenHubWithGrants(base, [{ itemId: "kessen-aetherion", quantity: 1 }]).owned,
    ).toEqual({ "kessen-colossus": 1, "kessen-aetherion": 1 });
  });

  it("counts packs as granted items but not as owned cards", () => {
    const base = hub();
    expect(
      getKessenHubWithGrants(base, [{ itemId: "kessen-pack-paper", quantity: 1 }]),
    ).toBe(base);
  });

  it("reports results that put items in the inventory, packs included", () => {
    const none = result({ weeklyFirstWinPack: false });
    expect(kessenResultGrantsItems(payload({ result: none }))).toBe(false);
    expect(kessenResultGrantsItems(payload({ result: result() }))).toBe(true);
    const drop = { itemId: "kessen-colossus", rarity: "COMMON", forbidden: false };
    expect(
      kessenResultGrantsItems(
        payload({
          result: { ...none, drops: [{ ...drop, surplus: true, soldFor: 30 }] },
        } as Partial<KessenMatchPayload>),
      ),
    ).toBe(false);
    expect(
      kessenResultGrantsItems(
        payload({
          result: { ...none, drops: [{ ...drop, surplus: false, soldFor: null }] },
        } as Partial<KessenMatchPayload>),
      ),
    ).toBe(true);
    expect(
      kessenResultGrantsItems(
        payload({
          result: result({ ...none, firstWin: { itemIds: ["x"], choice: null } }),
        }),
      ),
    ).toBe(true);
    expect(
      kessenResultGrantsItems(payload({ status: "ACTIVE", result: result() })),
    ).toBe(false);
  });

  it("asks for a hub refresh only when progress-derived state changed", () => {
    expect(kessenEndNeedsHubRefresh(payload())).toBe(false);
    expect(
      kessenEndNeedsHubRefresh(
        payload({ result: result({ firstWin: { itemIds: ["x"], choice: null } }) }),
      ),
    ).toBe(true);
    expect(
      kessenEndNeedsHubRefresh(payload({ result: result({ lessonCompleted: true }) })),
    ).toBe(true);
  });
});
