import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { STRONGHOLD_MONTHLY_MAINTENANCE } from "@/drizzle/constants";
import { clan, village } from "@/drizzle/schema";
import { GET } from "@/app/api/daily-hideout-downgrade/route";
import * as gamesettings from "@/libs/gamesettings";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";
import { barrier } from "../../../setup/statements";

import { insertClans } from "../../../setup/factories";
const cost = STRONGHOLD_MONTHLY_MAINTENANCE;
const dueAt = new Date(Date.now() - 31 * 86400_000);
const request = () => new Request("https://example.com/api/daily-hideout-downgrade");

/** Seed an overdue Stronghold and its owning faction in the throwaway database. */
const seedMaintenance = async (points: number) => {
  const db = await getTestDatabase();
  await db.insert(village).values({
    id: "stronghold",
    name: "Stronghold",
    sector: 301,
    type: "STRONGHOLD",
    kageId: "leader",
    lastMaintenancePaidAt: dueAt,
  });
  await insertClans([
    {
      id: "faction",
      name: "Faction",
      villageId: "stronghold",
      leaderId: "leader",
      hasHideout: true,
      points,
    },
  ]);
  return db;
};

describeWithDatabase("Stronghold monthly maintenance", () => {
  beforeEach(async () => {
    await resetTables(clan, village);
    stubCronAuth(() => null);
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({
      ...timerClaimFixture(),
      isNewDay: true,
      prevTime: new Date(0),
      prevValue: 0,
      response: Response.json("Ready"),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it.each([cost - 1, cost, cost * 2])(
    "charges or downgrades once when duplicate claims start with %s points",
    async (points) => {
      const db = await seedMaintenance(points);
      const bothPrefetched = barrier(2);
      stubDatabase({
        select: db.select.bind(db),
        execute: async (...args: Parameters<typeof db.execute>) => {
          // Both requests must finish their prefetch before either maintenance claim runs.
          await bothPrefetched();
          return db.execute(...args);
        },
      });
      const responses = await Promise.all([GET(request()), GET(request())]);
      expect(responses.every((response) => response.status === 200)).toBe(true);
      const [faction, settlement] = await Promise.all([
        db.query.clan.findFirst(),
        db.query.village.findFirst(),
      ]);
      expect(faction?.points).toBe(points < cost ? points : points - cost);
      expect(settlement).toMatchObject({
        type: points < cost ? "HIDEOUT" : "STRONGHOLD",
        wasDowngraded: points < cost,
      });
      expect(settlement!.lastMaintenancePaidAt.getTime()).toBeGreaterThan(
        dueAt.getTime(),
      );
    },
  );

  it("uses the current balance when points are spent after the due-settlement prefetch", async () => {
    const db = await seedMaintenance(cost * 2);
    stubDatabase({
      select: db.select.bind(db),
      execute: async (...args: Parameters<typeof db.execute>) => {
        await db
          .update(clan)
          .set({ points: cost - 1 })
          .where(eq(clan.id, "faction"));
        return db.execute(...args);
      },
    });
    expect((await GET(request())).status).toBe(200);
    expect((await db.query.clan.findFirst())?.points).toBe(cost - 1);
    expect(await db.query.village.findFirst()).toMatchObject({
      type: "HIDEOUT",
      wasDowngraded: true,
    });
  });

  it("does not charge a settlement that changed type after prefetch", async () => {
    const db = await seedMaintenance(cost * 2);
    stubDatabase({
      select: db.select.bind(db),
      execute: async (...args: Parameters<typeof db.execute>) => {
        await db
          .update(village)
          .set({ type: "HIDEOUT" })
          .where(eq(village.id, "stronghold"));
        return db.execute(...args);
      },
    });
    expect((await GET(request())).status).toBe(200);
    expect((await db.query.clan.findFirst())?.points).toBe(cost * 2);
    expect(await db.query.village.findFirst()).toEqual(
      expect.objectContaining({
        type: "HIDEOUT",
        wasDowngraded: false,
        lastMaintenancePaidAt: dueAt,
      }),
    );
  });
});
