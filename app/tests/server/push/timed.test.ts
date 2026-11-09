import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { Redis } from "@upstash/redis";
import * as Sentry from "@sentry/nextjs";
import { HOSPITAL_BASE_HEAL_SECONDS } from "@/drizzle/constants";
import { userDevice } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import * as push from "@/server/utils/push";
import * as apns from "@/server/utils/push/apns";
import * as fcm from "@/server/utils/push/fcm";
import { timerElapsed } from "@/server/utils/push/messages";
import {
  createTimedPushSender,
  deliverDueTimedPushes,
  dueTimedPushEvents,
  timedPushKey,
  type TimedPushEvent,
} from "@/server/utils/push/timed";
import { secondsFromDate } from "@/utils/time";
import { hasLocalRedis, startLocalRedis } from "../../setup/localRedis";

const now = new Date("2026-10-19T10:00:00Z");
const event: TimedPushEvent = {
  userId: "timer-user",
  kind: "jutsu",
  sourceId: "jutsu-one",
  endsAt: now,
};
const sent = { sent: 1, failed: 0, expiredTokens: [] };
const integration = hasLocalRedis ? describe : describe.skip;
integration("background timer delivery receipts (real Redis)", () => {
  let redis: Redis;
  let close: () => void;
  let send: ReturnType<typeof createTimedPushSender>;
  beforeAll(async () => {
    ({ redis, close } = await startLocalRedis("push-timers"));
    send = createTimedPushSender(redis);
  });
  afterAll(() => close?.());
  afterEach(() => vi.restoreAllMocks());

  it("allows one concurrent worker and consumes a successful event across later runs", async () => {
    let finish: () => void = () => {};
    const delivery = vi.fn(
      () =>
        new Promise<typeof sent>((resolve) => {
          finish = () => resolve(sent);
        }),
    );
    const first = send(event, delivery);
    while (delivery.mock.calls.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await send(event, delivery)).toBe("duplicate");
    finish();
    expect(await first).toBe("complete");
    expect(await send(event, delivery)).toBe("duplicate");
    expect(delivery).toHaveBeenCalledTimes(1);
    const ttl = await redis.ttl(timedPushKey(event));
    expect(ttl).toBeGreaterThan(86400);
    expect(ttl).toBeLessThanOrEqual(172800);
  });
  it("retries a total transient failure without holding the receipt", async () => {
    const retry = { ...event, sourceId: "transient" };
    expect(
      await send(retry, async () => ({ sent: 0, failed: 1, expiredTokens: [] })),
    ).toBe("retry");
    expect(await send(retry, async () => sent)).toBe("complete");
  });
  it("consumes opt-outs and permanently rejected tokens instead of replaying old timers", async () => {
    for (const [sourceId, summary] of [
      ["muted", { sent: 0, failed: 0, expiredTokens: [] }],
      ["expired", { sent: 0, failed: 1, expiredTokens: ["dead-test-token"] }],
    ] as const) {
      const current = { ...event, sourceId };
      expect(
        await send(current, async () => ({
          ...summary,
          expiredTokens: [...summary.expiredTokens],
        })),
      ).toBe("complete");
      expect(await send(current, async () => sent)).toBe("duplicate");
    }
  });
  it("releases a thrown delivery and gives a later timer its own receipt", async () => {
    const retry = { ...event, sourceId: "thrown" };
    await expect(
      send(retry, async () => {
        throw new Error("transport failed");
      }),
    ).rejects.toThrow("transport failed");
    expect(await send(retry, async () => sent)).toBe("complete");
    expect(
      await send(
        { ...retry, endsAt: secondsFromDate(60, retry.endsAt) },
        async () => sent,
      ),
    ).toBe("complete");
    expect(timedPushKey(event)).not.toContain(event.userId);
  });
  it("does not let an expired worker release or finish a newer owner's claim", async () => {
    const current = { ...event, sourceId: "expired-worker" };
    let finish: () => void = () => {};
    const delivery = vi.fn(
      () =>
        new Promise<typeof sent>((resolve) => {
          finish = () => resolve(sent);
        }),
    );
    const first = send(current, delivery);
    while (delivery.mock.calls.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await redis.set(timedPushKey(current), "new-worker", { ex: 600 });
    finish();
    await first;
    expect(await redis.get<string>(timedPushKey(current))).toBe("new-worker");
  });
  it("retries the real dispatcher's caught lookup failure instead of consuming it as a muted event", async () => {
    const current = { ...event, sourceId: "dispatch-lookup" };
    const devices = [
      { userId: event.userId, token: "synthetic-device", platform: "android" },
    ];
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new Error("Synthetic database outage"))
      .mockResolvedValue(devices);
    const client = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => (table === userDevice ? lookup() : Promise.resolve([])),
        }),
      }),
    } as unknown as DrizzleClient;
    vi.spyOn(fcm, "isConfigured").mockReturnValue(true);
    vi.spyOn(apns, "isConfigured").mockReturnValue(false);
    const transport = vi
      .spyOn(fcm, "sendAlerts")
      .mockResolvedValue([{ token: "synthetic-device", status: "sent" }]);
    vi.spyOn(apns, "sendAlerts").mockResolvedValue([]);
    vi.spyOn(Sentry, "captureException").mockReturnValue("synthetic-event");
    const deliver = () =>
      push.sendPushToUsers(client, [event.userId], timerElapsed("jutsu", "synthetic"));
    expect(await send(current, deliver)).toBe("retry");
    expect(await redis.get(timedPushKey(current))).toBeNull();
    expect(await send(current, deliver)).toBe("complete");
    expect(await send(current, deliver)).toBe("duplicate");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("retains successful real dispatch outcomes when pruning fails and never replays the alert", async () => {
    const current = { ...event, sourceId: "dispatch-prune" };
    const devices = [
      { userId: event.userId, token: "synthetic-live", platform: "android" },
      { userId: event.userId, token: "synthetic-expired", platform: "android" },
    ];
    const prune = vi.fn().mockRejectedValue(new Error("Synthetic cleanup outage"));
    const client = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => Promise.resolve(table === userDevice ? devices : []),
        }),
      }),
      delete: () => ({ where: prune }),
    } as unknown as DrizzleClient;
    vi.spyOn(fcm, "isConfigured").mockReturnValue(true);
    vi.spyOn(apns, "isConfigured").mockReturnValue(false);
    const transport = vi.spyOn(fcm, "sendAlerts").mockResolvedValue([
      { token: "synthetic-live", status: "sent" },
      { token: "synthetic-expired", status: "expired", reason: "UNREGISTERED" },
    ]);
    vi.spyOn(apns, "sendAlerts").mockResolvedValue([]);
    vi.spyOn(Sentry, "captureException").mockReturnValue("synthetic-event");
    const deliver = () =>
      push.sendPushToUsers(client, [event.userId], timerElapsed("jutsu", "synthetic"));
    expect(await send(current, deliver)).toBe("complete");
    expect(await send(current, deliver)).toBe("duplicate");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(prune).toHaveBeenCalledTimes(1);
  });
  it("runs persisted recovery and training delivery without the app or a foreground profile read", async () => {
    const current = user({
      userId: "background-worker",
      status: "HOSPITALIZED",
      jutsus: [{ id: "background-jutsu", finishTraining: now }],
    });
    const client = {
      selectDistinct: () => ({
        from: () => ({ where: () => Promise.resolve([{ userId: current.userId }]) }),
      }),
      query: { userData: { findMany: vi.fn().mockResolvedValue([current]) } },
    } as unknown as DrizzleClient;
    const delivery = vi.fn().mockResolvedValue(sent);
    vi.spyOn(Redis, "fromEnv").mockReturnValue(redis);
    vi.spyOn(push, "isPushEnabled").mockReturnValue(true);
    vi.spyOn(push, "sendPushToUsers").mockImplementation(delivery);
    expect(await deliverDueTimedPushes(client, now)).toEqual({ processed: 2 });
    expect(delivery).toHaveBeenCalledWith(
      client,
      [current.userId],
      expect.objectContaining({ category: "recovery", url: "/hospital" }),
    );
    expect(delivery).toHaveBeenCalledWith(
      client,
      [current.userId],
      expect.objectContaining({ category: "training", url: "/jutsus" }),
    );
    expect(await deliverDueTimedPushes(client, now)).toEqual({ processed: 0 });
    expect(delivery).toHaveBeenCalledTimes(2);
  });
});

type TimerUser = Parameters<typeof dueTimedPushEvents>[0];
const user = (overrides: Partial<TimerUser> = {}): TimerUser => ({
  userId: "timer-user",
  status: "AWAKE",
  village: null,
  jutsus: [],
  regenAt: secondsFromDate(-HOSPITAL_BASE_HEAL_SECONDS, now),
  currentlyTrainingMastery: null,
  masteryTrainingStartedAt: null,
  trainingSpeed: "15min",
  currentlyTrainingElement: null,
  elementalTrainingStartedAt: null,
  elementalTrainingSpeed: "15min",
  covertTrainingType: null,
  covertTrainingStartedAt: null,
  covertTrainingMinutes: null,
  ...overrides,
});

describe("persisted timer eligibility", () => {
  it("notifies hospital expiry without a foreground read, and skips healed/cancelled stays", () => {
    expect(dueTimedPushEvents(user({ status: "HOSPITALIZED" }), now)).toEqual([
      expect.objectContaining({ kind: "hospital", endsAt: now }),
    ]);
    expect(dueTimedPushEvents(user(), now)).toEqual([]);
    expect(
      dueTimedPushEvents(user({ status: "HOSPITALIZED", regenAt: now }), now),
    ).toEqual([]);
  });
  it("covers elapsed mastery, elemental, covert and jutsu timers with stable independent keys", () => {
    const current = user({
      currentlyTrainingMastery: "taijutsuMastery",
      masteryTrainingStartedAt: secondsFromDate(-900, now),
      currentlyTrainingElement: "Fire",
      elementalTrainingStartedAt: secondsFromDate(-900, now),
      covertTrainingType: "stealth",
      covertTrainingStartedAt: secondsFromDate(-60, now),
      covertTrainingMinutes: 1,
      jutsus: [
        { id: "done", finishTraining: now },
        { id: "future", finishTraining: secondsFromDate(60, now) },
      ],
    });
    const events = dueTimedPushEvents(current, now);
    expect(events.map(({ kind }) => kind)).toEqual([
      "mastery",
      "element",
      "covert",
      "jutsu",
    ]);
    expect(new Set(events.map(timedPushKey)).size).toBe(4);
  });
  it("does not replay old or cancelled training sessions", () => {
    const current = user({
      currentlyTrainingMastery: null,
      masteryTrainingStartedAt: secondsFromDate(-900, now),
      covertTrainingType: null,
      covertTrainingStartedAt: secondsFromDate(-60, now),
      covertTrainingMinutes: 1,
      jutsus: [
        { id: "old", finishTraining: secondsFromDate(-86401, now) },
        { id: "cleared", finishTraining: null },
      ],
    });
    expect(dueTimedPushEvents(current, now)).toEqual([]);
  });
});
