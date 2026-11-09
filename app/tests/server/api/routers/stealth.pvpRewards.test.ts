import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  CovertTrainingTypes,
  PVP_EXPERIENCE_AVERAGE_SETTING,
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
} from "@/drizzle/constants";
import { getPvpBoost } from "@/libs/pvpExperience";
import { getStealthStatus } from "@/libs/stealth";
import { stealthRouter } from "@/server/api/routers/stealth";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { callerForDatabase } from "../../../setup/testDatabase";

beforeEach(() => setSystemTime(new Date("2026-10-07T12:00:00Z")));
afterEach(() => setSystemTime());
afterEach(resetServerModuleStubs);

for (const type of CovertTrainingTypes) {
  it.each([
    { xp: 1400, kills: 0, current: 1000, gained: 3450 },
    { xp: 1400, kills: 1, current: 1000, gained: 3457.5 },
    { xp: 0, kills: 0, current: 1000, gained: 3000 },
    { xp: 1400, kills: 0, current: 16800, gained: 3200 },
    { xp: 1400, kills: 0, current: 19900, gained: 100 },
  ])(
    `${type} start, status and collection agree for XP=$xp, kills=$kills, stat=$current`,
    async ({ xp, kills, current, gained }) => {
      const now = new Date();
      const settings = [
        { id: "avg", name: PVP_EXPERIENCE_AVERAGE_SETTING, value: 1000, time: now },
      ];
      const user = {
        userId: "covert-player",
        status: "AWAKE",
        pvpExperience: xp,
        weeklyPvpKills: kills,
        weeklyPvpKillsAt: now,
        isAi: false,
        stealth: current,
        sensory: current,
        stealthActive: false,
        stealthActivatedAt: null,
        stealthCooldownAt: null,
        lastSensoryAt: null,
        covertTrainingType: null,
        covertTrainingStartedAt: null,
        covertTrainingMinutes: null,
      };
      const writes: Record<string, unknown>[] = [];
      const database = {
        update: () => ({
          set: (values: Record<string, unknown>) => {
            writes.push(values);
            return { where: async () => ({ rowsAffected: 1 }) };
          },
        }),
      };
      const caller = callerForDatabase(stealthRouter, user.userId, database as never);
      stubProfile("fetchUpdatedUser", (() =>
        Promise.resolve({ user, settings })) as never);

      const started = await caller.trainCovert({ type, minutes: 60 });
      expect(started.success).toBe(true);
      expect(started.data?.covertTrainingGain).toBe(gained);

      const trainingUser = {
        ...user,
        covertTrainingType: type,
        covertTrainingStartedAt: new Date(now.getTime() - 60 * 60 * 1000 - 1000),
        covertTrainingMinutes: 60,
        pvpBoost: getPvpBoost(user, settings, now),
      };
      stubProfile("fetchUpdatedUser", (() =>
        Promise.resolve({ user: trainingUser, settings })) as never);
      expect(
        getStealthStatus(
          trainingUser,
          STEALTH_SENSORY_CAP,
          STEALTH_TRAIN_GAIN_PER_MINUTE,
        )?.covertTrainingGain,
      ).toBe(gained);

      const collected = await caller.stopCovertTraining();
      expect(collected.success).toBe(true);
      expect(collected.data).toEqual({ gained, newValue: current + gained });
      const statement = writes[1]?.[type] as SQL;
      expect(new MySqlDialect().sqlToQuery(statement).params).toEqual([
        gained,
        STEALTH_SENSORY_CAP,
      ]);
    },
  );
}
