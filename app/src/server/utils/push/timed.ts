import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { UserData, VillageStructure } from "@/drizzle/schema";
import { calcUserHealFinish } from "@/libs/hospital";
import { calcCovertTrainingFinishAt } from "@/libs/stealth";
import { masteryTrainingEndsAt } from "@/libs/train";
import {
  listUserDataForDeliverDueTimedPushes,
  selectDistinctUserDeviceForDeliverDueTimedPushes,
} from "@/queries/push";
import type { DrizzleClient } from "@/server/db";
import { isPushEnabled, sendPushToUsers } from "@/server/utils/push";
import { mapWithConcurrency } from "./batch";
import { timerElapsed } from "./messages";
import type { PushSendSummary } from "./types";

type TimerKind = Parameters<typeof timerElapsed>[0];
export type TimedPushEvent = {
  userId: string;
  kind: TimerKind;
  sourceId: string;
  endsAt: Date;
};
type TimerUser = Pick<
  UserData,
  | "userId"
  | "status"
  | "regenAt"
  | "currentlyTrainingMastery"
  | "masteryTrainingStartedAt"
  | "trainingSpeed"
  | "currentlyTrainingElement"
  | "elementalTrainingStartedAt"
  | "elementalTrainingSpeed"
  | "covertTrainingType"
  | "covertTrainingStartedAt"
  | "covertTrainingMinutes"
> & {
  village: { structures: VillageStructure[] } | null;
  jutsus: { id: string; finishTraining: Date | null }[];
};

const LOOKBACK_SECONDS = 24 * 60 * 60;
const LEASE_SECONDS = 10 * 60;
const RETAIN_SECONDS = 2 * LOOKBACK_SECONDS;

/** Stable, opaque receipt: no message text, names, email or device token enters Redis. */
export const timedPushKey = (event: TimedPushEvent) =>
  `push-timer:${createHash("sha256")
    .update(
      JSON.stringify([
        event.userId,
        event.kind,
        event.sourceId,
        event.endsAt.toISOString(),
      ]),
    )
    .digest("hex")}`;

/** Compare the owner before finalizing or releasing a lease; an expired worker cannot erase a new one. */
const FINISH = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == 'done' then
  redis.call('SET', KEYS[1], 'done', 'EX', ARGV[3])
else
  redis.call('DEL', KEYS[1])
end
return 1
`;

/** Reuses the app's Redis service to deduplicate overlapping cron invocations and retries. */
export const createTimedPushSender =
  (redis: Redis) =>
  async (event: TimedPushEvent, deliver: () => Promise<PushSendSummary>) => {
    const key = timedPushKey(event);
    const owner = randomUUID();
    if (!(await redis.set(key, owner, { nx: true, ex: LEASE_SECONDS })))
      return "duplicate";
    let summary: PushSendSummary;
    try {
      summary = await deliver();
    } catch (error) {
      await redis.eval(FINISH, [key], [owner, "retry", RETAIN_SECONDS]);
      throw error;
    }
    // A muted/no-device event is consumed. Never send old timers when a player later
    // unmutes; retry transient total failures, but avoid duplicating successful fan-out.
    const complete =
      summary.sent > 0 ||
      (!summary.dispatchFailed && summary.failed === summary.expiredTokens.length);
    await redis.eval(
      FINISH,
      [key],
      [owner, complete ? "done" : "retry", RETAIN_SECONDS],
    );
    return complete ? "complete" : "retry";
  };

/** Read persisted active timers, including while the app is closed. Never grant or settle game rewards. */
export const dueTimedPushEvents = (user: TimerUser, now: Date): TimedPushEvent[] => {
  const events: TimedPushEvent[] = [];
  const add = (kind: TimerKind, sourceId: string, endsAt: Date | null) => {
    if (
      endsAt &&
      endsAt <= now &&
      endsAt.getTime() >= now.getTime() - LOOKBACK_SECONDS * 1000
    ) {
      events.push({ userId: user.userId, kind, sourceId, endsAt });
    }
  };
  if (user.status === "HOSPITALIZED")
    add("hospital", "hospital", calcUserHealFinish(user));
  add("mastery", "mastery", masteryTrainingEndsAt(user));
  add("element", "element", masteryTrainingEndsAt(user, "ELEMENT"));
  if (user.covertTrainingType)
    add(
      "covert",
      "covert",
      calcCovertTrainingFinishAt(
        user.covertTrainingStartedAt,
        user.covertTrainingMinutes,
      ),
    );
  for (const jutsu of user.jutsus) add("jutsu", jutsu.id, jutsu.finishTraining);
  return events;
};

/** One authenticated minute worker covers recovery and timed training without a foreground request. */
export const deliverDueTimedPushes = async (
  client: DrizzleClient,
  now = new Date(),
) => {
  if (!isPushEnabled()) return { processed: 0 };
  const devices = await selectDistinctUserDeviceForDeliverDueTimedPushes(client, now);
  const userIds = devices.map(({ userId }) => userId);
  if (!userIds.length) return { processed: 0 };
  const send = createTimedPushSender(Redis.fromEnv());
  let processed = 0;
  // Keep recipient predicates bounded as native adoption grows.
  for (let offset = 0; offset < userIds.length; offset += 200) {
    const users = await listUserDataForDeliverDueTimedPushes(
      client,
      userIds,
      offset,
      now,
      LOOKBACK_SECONDS,
    );
    const events = users.flatMap((user) => dueTimedPushEvents(user, now));
    const outcomes = await mapWithConcurrency(
      events,
      async (event) => {
        try {
          const outcome = await send(event, () =>
            sendPushToUsers(
              client,
              [event.userId],
              timerElapsed(event.kind, timedPushKey(event).slice(-48)),
            ),
          );
          if (outcome === "complete") processed++;
          return { error: null };
        } catch (error) {
          return { error };
        }
      },
      5,
    );
    // Finish siblings before rolling the minute timer back; their receipts survive retries.
    const failed = outcomes.find((outcome) => outcome.error);
    if (failed) throw failed.error;
  }
  return { processed };
};
