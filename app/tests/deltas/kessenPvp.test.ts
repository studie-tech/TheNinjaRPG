import { describe, expect, it } from "bun:test";
import {
  getKessenPvpLobbyAfterEnd,
  getKessenPvpLobbyAfterStart,
  getKessenPvpLobbyQueueStatus,
  getKessenPvpLobbyWithoutChallenge,
  getKessenPvpMatchCache,
  isNewerKessenPvpVersion,
} from "@/deltas/kessenPvp";
import type {
  KessenEvent,
  KessenPvpLobby,
  KessenPvpMatchPayload,
  KessenPvpViewResult,
} from "@/validators/kessen";

const payload = (patch: Partial<KessenPvpMatchPayload> = {}): KessenPvpMatchPayload =>
  ({
    id: "m",
    kind: "RANKED",
    version: 3,
    status: "ACTIVE",
    seat: 1,
    players: [
      {
        userId: "a",
        username: "A",
        avatar: null,
        level: 1,
        villageName: null,
        rating: 1000,
      },
      {
        userId: "b",
        username: "B",
        avatar: null,
        level: 1,
        villageName: null,
        rating: 1000,
      },
    ],
    view: { inst: {} },
    clock: { deadline: null, acting: [1] },
    result: null,
    ...patch,
  }) as KessenPvpMatchPayload;

const lobby = (): KessenPvpLobby => ({
  lessonCompleted: true,
  ranked: {
    rating: 1000,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    rewardedToday: 0,
    rewardedCap: 5,
    weeklyWins: 0,
    weeklyPackWins: 5,
    winRyo: 800,
  },
  activeMatch: null,
  challenges: [
    {
      id: "r1",
      outgoing: false,
      status: "PENDING",
      createdAt: new Date(0),
      expiresAt: new Date(0),
      opponent: {
        userId: "a",
        username: "A",
        level: 1,
        rank: "GENIN",
        villageName: null,
      },
      matchId: null,
    },
  ],
  queue: { queuedAt: new Date(0), matchId: null },
  queueCount: 2,
});

const played: KessenEvent = { t: "played", seat: 0, id: "s0-1", cardId: "card" };

describe("kessen duel deltas", () => {
  it("keeps the newer cached duel and extends a log in step", () => {
    const cached = { match: payload({ version: 5 }), log: null };
    expect(getKessenPvpMatchCache(cached, payload({ version: 4 }))).toBe(cached);
    const inStep = {
      match: payload({ version: 3 }),
      log: { version: 3, events: [], inst: {} },
    };
    const next = getKessenPvpMatchCache(inStep, payload({ version: 4 }), [played]);
    expect(next.log).toEqual({ version: 4, events: [played], inst: {} });
    expect(isNewerKessenPvpVersion(inStep, { version: 3 })).toBe(false);
    expect(isNewerKessenPvpVersion(inStep, { version: 4 })).toBe(true);
  });

  it("moves challenges, the active duel and the rating through the lobby", () => {
    expect(getKessenPvpLobbyWithoutChallenge(lobby(), "r1").challenges).toEqual([]);
    const started = getKessenPvpLobbyAfterStart(lobby(), payload());
    expect(started.queue).toBeNull();
    expect(started.activeMatch).toMatchObject({
      id: "m",
      seat: 1,
      opponent: { userId: "a" },
      yourTurn: true,
    });
    const result: KessenPvpViewResult = {
      winner: 1,
      outcome: "win",
      endedBy: "play",
      loserBy: null,
      rating: {
        you: { before: 1000, after: 1012, delta: 12 },
        opponent: { before: 1000, after: 988, delta: -12 },
      },
      reward: { ryo: 800, packItemId: null },
      note: null,
      settling: false,
    };
    const ended = getKessenPvpLobbyAfterEnd(
      started,
      payload({ status: "FINISHED", result }),
    );
    expect(ended.activeMatch).toBeNull();
    expect(ended.ranked).toMatchObject({
      rating: 1012,
      played: 1,
      wins: 1,
      rewardedToday: 1,
    });
    const settling = getKessenPvpLobbyAfterEnd(
      started,
      payload({ status: "FINISHED", result: { ...result, settling: true } }),
    );
    expect(settling.ranked.rating).toBe(1000);
  });

  it("keeps the queue row only while the player still searches", () => {
    const queuedAt = new Date(5_000);
    const searching = getKessenPvpLobbyQueueStatus(
      { ...lobby(), queue: null },
      { inQueue: true, queuedAt, queueCount: 4 },
    );
    expect(searching.queue).toEqual({ queuedAt, matchId: null });
    expect(searching.queueCount).toBe(4);
    const left = getKessenPvpLobbyQueueStatus(lobby(), { inQueue: false, queuedAt });
    expect(left.queue).toBe(null);
    expect(left.queueCount).toBe(2);
  });
});
