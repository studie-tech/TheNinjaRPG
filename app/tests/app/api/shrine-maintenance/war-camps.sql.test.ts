import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/shrine-maintenance/route";
import { WAR_CAMP_DURATION_HOURS, WAR_INSTANCE_HEALTH } from "@/drizzle/constants";
import {
  gameSetting,
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  userData,
  village,
  war,
  warCamp,
} from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import * as villageRouter from "@/queries/village";
import * as objectiveWar from "@/server/utils/objectiveWar";
import { defaultWarRules } from "@/validators/war";
import { restoreEnvAfterEach } from "../../../setup/env";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const minuteTimer = "shrine-maintenance";
const dailyTimer = "shrine-maintenance-daily";
const cronSecret = "shrine-maintenance-test-secret";

const request = () =>
  new Request("http://localhost/api/shrine-maintenance", {
    headers: { authorization: `Bearer ${cronSecret}` },
  });

describeWithDatabase("shrine minute scheduler war camps", () => {
  let now: Date;
  let previousMinute: Date;
  restoreEnvAfterEach("CRON_SECRET");

  beforeEach(async () => {
    // Keep simulated camp deadlines behind MySQL's real clock for its SQL guards.
    setSystemTime();
    now = new Date(Date.now() - 2 * 3600000);
    now.setUTCMinutes(17, 0, 0);
    setSystemTime(now);
    previousMinute = new Date(now.getTime() - 60000);
    process.env.CRON_SECRET = cronSecret;
    await resetTables(
      gameSetting,
      mpvpBattleUser,
      mpvpBattleQueue,
      warCamp,
      war,
      sector,
      userData,
      village,
    );
    vi.spyOn(gamesettings, "handleEndpointError");

    const db = await getTestDatabase();
    const combatStartedAt = new Date(now.getTime() - 10 * 60000);
    await db.insert(gameSetting).values([
      { id: minuteTimer, name: minuteTimer, time: previousMinute },
      { id: dailyTimer, name: dailyTimer, time: now },
    ]);
    await db.insert(village).values([
      { id: "camp-attacker", name: "Camp attacker", sector: 100, kageId: "ka" },
      { id: "camp-defender", name: "Camp defender", sector: 200, kageId: "kb" },
    ]);
    await db.insert(sector).values({ sector: 201, villageId: "camp-defender" });
    await insertUsers([{ userId: "camp-guardian", isAi: true, isWarCamp: true }]);
    await db.insert(war).values({
      id: "minute-war",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
      attackerVillageId: "camp-attacker",
      defenderVillageId: "camp-defender",
      rules: { ...defaultWarRules, enabled: true },
      combatStartedAt,
      lastTokenReductionAt: combatStartedAt,
      objectiveState: { attackerEspionage: 0, defenderEspionage: 0, objectives: [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
    setSystemTime();
  });

  it("opens camps between hourly ticks, respects the minute timer and resolves damage once", async () => {
    const db = await getTestDatabase();
    expect(now.getUTCMinutes()).toBe(17);
    expect((await GET(request())).status).toBe(200);
    const camps = await db.query.warCamp.findMany();
    expect(camps).toHaveLength(1);
    const camp = camps[0]!;
    expect(camp.id).toBe("minute-war:0");
    expect(camp.guardianId).toBe("camp-guardian");
    expect(camp.startsAt.getUTCMinutes()).toBe(7);
    expect(camp.endsAt.getTime() - camp.startsAt.getTime()).toBe(
      WAR_CAMP_DURATION_HOURS * 3600000,
    );

    const waiting = await recordQueries(() => GET(request()));
    expect(await waiting.result.text()).toContain("Wait until the next minute");
    expect(waiting.statements.join("\n")).not.toContain("`War`");
    expect(waiting.statements.join("\n")).not.toContain("WarCamp");

    setSystemTime(new Date(now.getTime() + 60000));
    expect((await GET(request())).status).toBe(200);
    expect(await db.query.warCamp.findMany()).toHaveLength(1);

    await db.update(warCamp).set({ attackerScore: 20, defenderScore: 10 });
    const afterCamp = new Date(camp.endsAt.getTime() + 60000);
    setSystemTime(afterCamp);
    expect((await GET(request())).status).toBe(200);
    const resolved = await db.query.warCamp.findFirst();
    const after = await db.query.war.findFirst();
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(after?.attackerWarHealth).toBe(WAR_INSTANCE_HEALTH);
    expect(after?.defenderWarHealth).toBe(
      WAR_INSTANCE_HEALTH - defaultWarRules.campDamage,
    );

    setSystemTime(new Date(afterCamp.getTime() + 60000));
    expect((await GET(request())).status).toBe(200);
    expect((await db.query.war.findFirst())?.defenderWarHealth).toBe(
      after?.defenderWarHealth,
    );
    expect(await db.query.warCamp.findMany()).toHaveLength(1);
  });

  it("authenticates before timers or camp queries", async () => {
    const { result, statements } = await recordQueries(() =>
      GET(new Request("http://localhost/api/shrine-maintenance")),
    );
    expect(result.status).toBe(401);
    expect(statements).toHaveLength(0);
  });

  it("restores the minute timer after camp failure so the same minute can retry", async () => {
    const db = await getTestDatabase();
    const failure = new Error("Camp synchronization failed");
    vi.spyOn(objectiveWar, "syncWarCamps").mockRejectedValueOnce(failure);
    vi.spyOn(gamesettings, "handleEndpointError").mockResolvedValueOnce(
      new Response("Internal server error", { status: 500 }),
    );

    expect((await GET(request())).status).toBe(500);
    expect(gamesettings.handleEndpointError).toHaveBeenCalledWith(failure);
    expect(await readTimer(minuteTimer)).toEqual(previousMinute);
    expect(await readTimer(dailyTimer)).toEqual(now);
    expect(await db.query.warCamp.findMany()).toHaveLength(0);

    expect((await GET(request())).status).toBe(200);
    expect(await db.query.warCamp.findMany()).toHaveLength(1);
    expect(await readTimer(minuteTimer)).toEqual(now);
  });

  it("restores both timers if daily maintenance fails after camps synchronize", async () => {
    const db = await getTestDatabase();
    const previousDay = new Date(now.getTime() - 86400000);
    await db
      .update(gameSetting)
      .set({ time: previousDay })
      .where(eq(gameSetting.name, dailyTimer));
    vi.spyOn(villageRouter, "fetchVillages").mockRejectedValueOnce(
      new Error("Daily maintenance failed"),
    );
    vi.spyOn(gamesettings, "handleEndpointError").mockResolvedValueOnce(
      new Response("Internal server error", { status: 500 }),
    );

    expect((await GET(request())).status).toBe(500);
    expect(await db.query.warCamp.findMany()).toHaveLength(1);
    expect(await readTimer(minuteTimer)).toEqual(previousMinute);
    expect(await readTimer(dailyTimer)).toEqual(previousDay);
  });
});

async function readTimer(name: string) {
  const db = await getTestDatabase();
  const timer = await db.query.gameSetting.findFirst({
    where: eq(gameSetting.name, name),
  });
  return timer?.time;
}
