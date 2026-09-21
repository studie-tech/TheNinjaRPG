import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  fishingRaidOccurrence,
  fishingRaidSchedule,
  fishingRaidTemplate,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Materialize UTC event windows ahead of time. The unique schedule/window key makes cron retries safe. */
export const syncFishingRaidOccurrences = async (
  db: DrizzleClient,
  now = new Date(),
) => {
  const schedules = await db.query.fishingRaidSchedule.findMany({
    where: eq(fishingRaidSchedule.active, true),
  });
  let created = 0;
  for (const schedule of schedules) {
    const template = await db.query.fishingRaidTemplate.findFirst({
      where: and(
        eq(fishingRaidTemplate.id, schedule.templateId),
        eq(fishingRaidTemplate.active, true),
      ),
    });
    if (!template) continue;
    const horizon = now.getTime() + 48 * 60 * 60 * 1000;
    const interval = schedule.recurrenceMinutes
      ? schedule.recurrenceMinutes * 60 * 1000
      : 0;
    let start = schedule.startsAt.getTime();
    if (interval && start < now.getTime() - schedule.spawnWindowSeconds * 1000)
      start +=
        Math.floor(
          (now.getTime() - schedule.spawnWindowSeconds * 1000 - start) / interval,
        ) * interval;
    for (
      let count = 0;
      start <= horizon && count < 100;
      count++, start += interval || horizon + 1
    ) {
      const opensAt = new Date(start);
      const closesAt = new Date(start + schedule.spawnWindowSeconds * 1000);
      const state = now >= closesAt ? "CLOSED" : now >= opensAt ? "OPEN" : "SCHEDULED";
      const config = {
        ...template.config,
        habitatId: template.habitatId,
        speciesId: template.speciesId,
        minimumLevel: template.minimumLevel,
        minimumParticipants: template.minimumParticipants,
        maximumParticipants: template.maximumParticipants,
        entryBait: template.entryBait,
        encounterSeconds: template.encounterSeconds,
        rewardExperience: template.rewardExperience,
        maxRewardsPerOccurrence: template.maxRewardsPerOccurrence,
      };
      const result = await db
        .insert(fishingRaidOccurrence)
        .values({
          id: nanoid(),
          scheduleId: schedule.id,
          templateId: template.id,
          templateVersion: template.version,
          templateConfig: config,
          opensAt,
          closesAt,
          state,
        })
        .onDuplicateKeyUpdate({ set: { state, closesAt } });
      created += Number(result.rowsAffected ?? 0) === 1 ? 1 : 0;
    }
  }
  await db
    .update(fishingRaidOccurrence)
    .set({ state: "OPEN" })
    .where(
      and(
        eq(fishingRaidOccurrence.state, "SCHEDULED"),
        lt(fishingRaidOccurrence.opensAt, now),
        gt(fishingRaidOccurrence.closesAt, now),
      ),
    );
  await db
    .update(fishingRaidOccurrence)
    .set({ state: "CLOSED" })
    .where(
      and(
        inArray(fishingRaidOccurrence.state, ["SCHEDULED", "OPEN"]),
        lt(fishingRaidOccurrence.closesAt, now),
      ),
    );
  return created;
};

export const requiredRaidAction = (
  phase: number,
  role: "PULLER" | "ANCHOR" | "GUIDE",
) => {
  if (phase === 1)
    return role === "PULLER" ? "REEL" : role === "ANCHOR" ? "HOLD" : "TURN";
  if (phase === 2)
    return role === "ANCHOR" ? "HOLD" : role === "GUIDE" ? "TURN" : "REEL";
  if (phase === 3)
    return role === "PULLER" ? "REEL" : role === "ANCHOR" ? "HOLD" : "TURN";
  if (phase === 4)
    return role === "ANCHOR" ? "SLACK" : role === "GUIDE" ? "TURN" : "REEL";
  return role === "PULLER" ? "REEL" : role === "ANCHOR" ? "HOLD" : "TURN";
};

export const nextRaidMeters = (
  phase: number,
  meters: { fishStamina: number; landingProgress: number; escapePressure: number },
) => {
  const fishStamina = Math.max(0, meters.fishStamina - (phase === 3 ? 28 : 14));
  const landingProgress = Math.min(
    100,
    meters.landingProgress + (phase === 5 ? 38 : 16),
  );
  const escapePressure = Math.max(0, meters.escapePressure - 8);
  const succeeded = landingProgress >= 100 || (fishStamina === 0 && phase >= 4);
  return {
    fishStamina,
    landingProgress,
    escapePressure,
    succeeded,
    nextPhase: Math.min(5, phase + 1),
  };
};
