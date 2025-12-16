import { drizzleDB } from "@/server/db";
import { shrineBoostSchedule, village } from "@/drizzle/schema";
import { and, lte, gt, eq, inArray } from "drizzle-orm";

type ShrineSettings = {
  unlockedAiIds: string[];
  activeBoosts: Record<string, string>; // boostType -> ISO endAt
  activeAiIds: string[];
};

function defaultShrineSettings(): ShrineSettings {
  return {
    unlockedAiIds: [],
    activeBoosts: {},
    activeAiIds: [],
  };
}

export async function runShrineBoostTick(now: Date = new Date()) {
  // 1) schedules that should be active now
  const activeSchedules = await drizzleDB
    .select()
    .from(shrineBoostSchedule)
    .where(and(lte(shrineBoostSchedule.startAt, now), gt(shrineBoostSchedule.endAt, now)));

  // Apply active boosts (only if changed)
  for (const s of activeSchedules) {
    const v = await drizzleDB.query.village.findFirst({
      where: eq(village.id, s.villageId),
      columns: { id: true, shrineSettings: true },
    });
    if (!v) continue;

    const shrineSettings: ShrineSettings =
      (v.shrineSettings as ShrineSettings | null) ?? defaultShrineSettings();

    const current = shrineSettings.activeBoosts?.[s.boostType];
    const next = s.endAt.toISOString();

    // Idempotent: skip if already set to same end time
    if (current === next) continue;

    const updatedBoosts = {
      ...(shrineSettings.activeBoosts ?? {}),
      [s.boostType]: next,
    };

    await drizzleDB
      .update(village)
      .set({
        shrineSettings: { ...shrineSettings, activeBoosts: updatedBoosts },
      })
      .where(eq(village.id, s.villageId));
  }

  // 2) schedules that ended (expire boost + delete the schedule row)
const expiredSchedules = await drizzleDB
  .select()
  .from(shrineBoostSchedule)
  .where(
    and(
      lte(shrineBoostSchedule.endAt, now),
      lte(shrineBoostSchedule.startAt, now),
    ),
  );


  for (const s of expiredSchedules) {
    const v = await drizzleDB.query.village.findFirst({
      where: eq(village.id, s.villageId),
      columns: { id: true, shrineSettings: true },
    });
    if (!v?.shrineSettings) {
      // still delete the expired schedule so it doesn't loop forever
      await drizzleDB.delete(shrineBoostSchedule).where(eq(shrineBoostSchedule.id, s.id));
      continue;
    }

    const shrineSettings = v.shrineSettings as ShrineSettings;
    const activeBoosts = shrineSettings.activeBoosts ?? {};

    // If the boost isn't present, just delete schedule and move on
    if (!(s.boostType in activeBoosts)) {
      await drizzleDB.delete(shrineBoostSchedule).where(eq(shrineBoostSchedule.id, s.id));
      continue;
    }

    const { [s.boostType]: _removed, ...rest } = activeBoosts;

    await drizzleDB
      .update(village)
      .set({
        shrineSettings: { ...shrineSettings, activeBoosts: rest },
      })
      .where(eq(village.id, s.villageId));

    // IMPORTANT: remove expired schedule so we don't process it every minute forever
    await drizzleDB.delete(shrineBoostSchedule).where(eq(shrineBoostSchedule.id, s.id));
  }

  return {
    activeApplied: activeSchedules.length,
    expiredProcessed: expiredSchedules.length,
  };
}
