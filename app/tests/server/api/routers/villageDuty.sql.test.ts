import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  VILLAGE_DUTY_MAX_PATROLS,
  VILLAGE_DUTY_SLOTS_PER_LEVEL,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  userAttribute,
  userCookingJob,
  userData,
  village,
  villageAlliance,
  villageDutyPresence,
  villageDutyShift,
  villageStructure,
} from "@/drizzle/schema";
import { WANDER_STEP_MS } from "@/libs/overworldWander";
import { Pusher } from "@/libs/pusher";
import { calcStealthDuration } from "@/libs/stealth";
import {
  isOnVillageDuty,
  villageDutyPatrols,
  villageDutyPosition,
  villageDutyPursuitPosition,
} from "@/libs/villageDuty";
import {
  claimVillageDutyPatrol,
  countVillageDuty,
  fetchVillageDutyHome,
  findVillageDutyShift,
  listVillageDutyCandidates,
  listVillageDutyPatrols,
  listVillageDutyRoster,
  listVillageDutyVisitors,
  releaseVillageDutyPatrol,
  touchVillageDutyPresence,
} from "@/queries/villageDuty";
import { combatRouter, initiateVillageDutyBattle } from "@/server/api/routers/combat";
import { travelRouter } from "@/server/api/routers/travel";
import { villageDutyRouter } from "@/server/api/routers/villageDuty";
import * as sectorMaps from "@/server/utils/sectorMap";
import {
  advanceVillageDutyPursuits,
  ensureVillageDutyShift,
} from "@/server/utils/villageDuty";
import { getUtcHourStart, secondsFromDate } from "@/utils/time";
import { insertDefaultAiProfile, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { sectorMap } from "../../../setup/sectorMap";
import { resetServerModuleStubs } from "../../../setup/serverModules";
import { beforeStatements, holdReads } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
  resolverOf,
} from "../../../setup/testDatabase";

describeWithDatabase("village duty hourly patrol", () => {
  beforeEach(async () => {
    resetServerModuleStubs();
    stubRateLimitTransport();
    await resetTables(
      aiProfile,
      battle,
      battleHistory,
      villageAlliance,
      villageDutyPresence,
      villageDutyShift,
      villageStructure,
      userAttribute,
      userCookingJob,
      userData,
      village,
    );
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "home",
      name: "Home",
      sector: 123,
      type: "VILLAGE",
      kageId: "leader",
    });
    await db.insert(villageStructure).values({
      id: "guards",
      name: "Village Protectors",
      image: "guards",
      villageId: "home",
      level: 1,
      patrolSlotsPerLvl: VILLAGE_DUTY_SLOTS_PER_LEVEL,
    });
    await insertUsers([
      {
        userId: "protector",
        username: "Protector",
        villageId: "home",
        rank: "CHUNIN",
        status: "AWAKE",
        sector: 123,
        location: "Village",
        updatedAt: new Date("2026-01-01"),
        joinedVillageAt: new Date("2025-01-01"),
      },
    ]);
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });
  const duty = async (enabled: boolean, villageId = "home") =>
    callerForDatabase(villageDutyRouter, "protector", await getTestDatabase()).setDuty({
      villageId,
      enabled,
    });
  const load = async () =>
    (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "protector"),
    });
  const shift = async (now = new Date()) => {
    const db = await getTestDatabase();
    return (await ensureVillageDutyShift(
      db,
      (await fetchVillageDutyHome(db, "home"))!,
      now,
    ))!;
  };

  /** Existing volunteers were enrolled before this hour; new signups wait for the next rotation. */
  const enrollCurrent = async () => {
    await duty(true);
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ villageDutyStartedAt: secondsFromDate(-1, getUtcHourStart()) })
      .where(eq(userData.userId, "protector"));
  };

  it("keeps offline copies enrolled without changing their owner, and withdrawal cannot refill a spent slot", async () => {
    const db = await getTestDatabase();
    const before = await load();
    expect((await duty(true)).success).toBe(true);
    await db
      .update(userData)
      .set({
        status: "HOSPITALIZED",
        villageDutyStartedAt: secondsFromDate(-1, getUtcHourStart()),
      })
      .where(eq(userData.userId, "protector"));
    expect(isOnVillageDuty((await load())!)).toBe(true);
    expect((await load())?.updatedAt).toEqual(before?.updatedAt);
    expect((await load())?.curHealth).toBe(before?.curHealth);
    const active = await shift();
    expect(active.patrols.map((entry) => entry.userId)).toEqual(["protector"]);
    expect(
      (await listVillageDutyPatrols(db, 123)).map((entry) => entry.userId),
    ).toEqual(["protector"]);
    expect((await duty(false)).success).toBe(true);
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    expect((await shift()).patrols).toEqual(active.patrols);
  });

  it.each([
    { rank: "GENIN" as const },
    { isBanned: true },
    { isAi: true },
    { isOutlaw: true },
    { sector: 456 },
    { status: "BATTLE" as const },
    { location: "" },
  ])("rejects ineligible signup atomically: %j", async (patch) => {
    const db = await getTestDatabase();
    await db.update(userData).set(patch).where(eq(userData.userId, "protector"));
    expect((await duty(true)).success).toBe(false);
    expect((await load())?.villageDutyVillageId).toBeNull();
  });

  it("excludes foreign enrollment and changed membership from the assigned roster", async () => {
    const db = await getTestDatabase();
    expect((await duty(true, "foreign")).success).toBe(false);
    await enrollCurrent();
    await shift();
    await db
      .update(userData)
      .set({ joinedVillageAt: new Date(Date.now() + 1000) })
      .where(eq(userData.userId, "protector"));
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    expect((await countVillageDuty(db, "home"))[0]?.count).toBe(0);
  });

  it("shares one capped hourly selection across town hall and map, with reserves and no mid-hour refills", async () => {
    const db = await getTestDatabase();
    const now = getUtcHourStart();
    await db
      .update(villageStructure)
      .set({ level: 15 })
      .where(eq(villageStructure.id, "guards"));
    await insertUsers(
      Array.from({ length: 100 }, (_, index) => ({
        userId: `volunteer-${index}`,
        username: `Volunteer ${index}`,
        villageId: "home",
        rank: "CHUNIN" as const,
        joinedVillageAt: new Date("2025-01-01"),
        villageDutyVillageId: "home",
        villageDutyStartedAt: new Date("2026-01-01"),
      })),
    );
    const candidates = await listVillageDutyCandidates(db, "home", now);
    expect(candidates).toHaveLength(VILLAGE_DUTY_MAX_PATROLS);
    const active = await shift(now);
    expect(active.capacity).toBe(20);
    expect(active.patrols.map((entry) => entry.userId)).toEqual(
      candidates.map((entry) => entry.userId),
    );
    expect((await shift(secondsFromDate(3599, now))).patrols).toEqual(active.patrols);
    expect(
      (await listVillageDutyRoster(db, "home", now)).map((entry) => entry.userId),
    ).toEqual(
      (await listVillageDutyPatrols(db, 123, now)).map((entry) => entry.userId),
    );
    const trace = await recordQueries(() =>
      resolverOf(villageDutyRouter.get)({
        ctx: { drizzle: db, userId: "protector" },
        input: { villageId: "home" },
      }),
    );
    expect(trace.statements).toHaveLength(4);
    expect(trace.roundTrips).toBe(1);
    expect(trace.result?.count).toBe(100);
    expect(trace.result?.capacity).toBe(20);
    expect(trace.result?.protectors).toHaveLength(20);
    expect(trace.result?.patrolStatus).toBe("RESERVE");
    expect((await duty(true)).success).toBe(true);
    expect((await shift(now)).patrols).toEqual(active.patrols);
    const next = await shift(secondsFromDate(3600, now));
    expect(next.startedAt).toEqual(secondsFromDate(3600, now));
    expect(next.patrols.map((entry) => entry.userId)).not.toEqual(
      active.patrols.map((entry) => entry.userId),
    );
    expect(next.patrols.every((entry) => !entry.defeated && !entry.battleId)).toBe(
      true,
    );
  });

  it("has one winner for concurrent claims and preserves shared depletion until rotation", async () => {
    const db = await getTestDatabase();
    await enrollCurrent();
    const active = await shift();
    const claims = await Promise.all([
      claimVillageDutyPatrol(db, active, 0, "fight-a"),
      claimVillageDutyPatrol(db, active, 0, "fight-b"),
    ]);
    expect(claims.map((claim) => claim.rowsAffected).sort()).toEqual([0, 1]);
    const claimed = (await findVillageDutyShift(db, "home"))!;
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    const reference = {
      villageId: "home",
      startedAt: claimed.startedAt.toISOString(),
      slot: 0,
      battleId: claimed.patrols[0]!.battleId!,
    };
    expect(
      (await releaseVillageDutyPatrol(db, { ...reference, battleId: "wrong" }, true))
        .rowsAffected,
    ).toBe(0);
    expect((await releaseVillageDutyPatrol(db, reference, true)).rowsAffected).toBe(1);
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    await duty(false);
    await duty(true);
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    const next = await shift(secondsFromDate(3600, claimed.startedAt));
    expect(next.patrols[0]?.defeated).toBe(false);
    expect((await releaseVillageDutyPatrol(db, reference, true)).rowsAffected).toBe(0);
    expect((await findVillageDutyShift(db, "home"))?.patrols[0]?.defeated).toBe(false);
  });

  it("returns a surviving copy after a failed admission or an enemy defeat without changing its owner", async () => {
    const db = await getTestDatabase();
    await enrollCurrent();
    const active = await shift();
    await claimVillageDutyPatrol(db, active, 0, "fight");
    await releaseVillageDutyPatrol(
      db,
      {
        villageId: "home",
        startedAt: active.startedAt.toISOString(),
        slot: 0,
        battleId: "fight",
      },
      false,
    );
    expect(await listVillageDutyPatrols(db, 123)).toHaveLength(1);
    expect((await load())?.status).toBe("AWAKE");
    expect((await load())?.battleId).toBeNull();
  });

  it("initializes one immutable roster under concurrent readers, including an empty roster", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    const home = (await fetchVillageDutyHome(db, "home"))!;
    const [first, second] = await Promise.all([
      ensureVillageDutyShift(db, home, now),
      ensureVillageDutyShift(db, home, now),
    ]);
    expect(first).toEqual(second);
    expect(first?.patrols).toEqual([]);
    await duty(true);
    expect((await shift(now)).patrols).toEqual([]);
  });

  it("expires map presence independently and scopes roster data to village homes", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    await touchVillageDutyPresence(db, "protector", 123, secondsFromDate(25, now));
    expect(await listVillageDutyVisitors(db, 123, now)).toHaveLength(1);
    expect(await listVillageDutyVisitors(db, 456, now)).toEqual([]);
    expect(await listVillageDutyVisitors(db, 123, secondsFromDate(26, now))).toEqual(
      [],
    );
    await enrollCurrent();
    await shift(now);
    expect(await listVillageDutyRoster(db, "foreign")).toEqual([]);
    await db.update(village).set({ type: "OUTLAW" }).where(eq(village.id, "home"));
    expect(await listVillageDutyRoster(db, "home")).toEqual([]);
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    expect(
      await callerForDatabase(villageDutyRouter, "protector", db).get({
        villageId: "home",
      }),
    ).toBeNull();
  });
  it("resumes roaming after the last visitor expires without allied heartbeat reads or writes", async () => {
    const db = await getTestDatabase();
    await enrollCurrent();
    const now = new Date();
    const active = await shift(now);
    await db
      .insert(village)
      .values({ id: "foreign", name: "Foreign", sector: 456, kageId: "enemy" });
    await db.insert(villageAlliance).values({
      id: "hostile",
      villageIdA: "home",
      villageIdB: "foreign",
      status: "ENEMY",
    });
    await insertUsers([
      {
        userId: "enemy",
        username: "Enemy",
        villageId: "foreign",
        sector: 123,
        location: "Village",
        status: "AWAKE",
      },
    ]);
    const home = (await fetchVillageDutyHome(db, "home"))!;
    const owners = await listVillageDutyRoster(db, "home", now);
    const map = sectorMap(10, 10, () => ({ zone: "village" }), { anchors: [] });
    const visitor = {
      userId: "enemy",
      villageId: "foreign",
      sector: 123,
      location: "Village",
      status: "AWAKE",
      isAi: false,
      isBanned: false,
      stealthActive: false,
      stealthActivatedAt: null,
      stealth: 1000,
      longitude: 9,
      latitude: 9,
    };
    const advanced = await advanceVillageDutyPursuits(
      db,
      { ...home, dutyShift: active },
      owners,
      [],
      map,
      visitor,
      now,
    );
    expect(advanced?.patrols[0]?.pursuit?.targetUserId).toBe("enemy");
    const expired = secondsFromDate(26, now);
    expect(await listVillageDutyVisitors(db, 123, expired)).toEqual([]);
    const trace = await recordQueries(() =>
      advanceVillageDutyPursuits(
        db,
        { ...home, dutyShift: advanced! },
        owners,
        [],
        map,
        { ...visitor, userId: "protector", villageId: "home" },
        expired,
      ),
    );
    expect(trace.result).toBeNull();
    expect(trace.statements).toHaveLength(0);
    const stored = (await findVillageDutyShift(db, "home"))!;
    const actor = villageDutyPatrols(
      await listVillageDutyPatrols(db, 123, now),
      map,
      123,
      "home",
      stored.patrols,
    )[0]!;
    expect(
      villageDutyPursuitPosition(actor.npcWander!.pursuit!, expired.getTime()),
    ).toBeNull();
    expect(
      villageDutyPosition(stored.patrols[0]!, actor, map, expired.getTime()),
    ).toEqual(
      villageDutyPosition(
        { ...stored.patrols[0]!, pursuit: null },
        actor,
        map,
        expired.getTime(),
      ),
    );
  });
  it("pursues an active enemy without a roll and globally spends the copy after combat", async () => {
    const db = await getTestDatabase();
    const map = sectorMap(20, 20, () => ({ zone: "village" }), {
      sector: 123,
      anchors: [],
    });
    vi.spyOn(sectorMaps, "fetchPublishedSectorMap").mockResolvedValue(map);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertDefaultAiProfile();
    await db
      .insert(village)
      .values({ id: "invaders", name: "Invaders", sector: 456, kageId: "invader" });
    await db.insert(villageAlliance).values({
      id: "hostile",
      villageIdA: "home",
      villageIdB: "invaders",
      status: "ENEMY",
    });
    await insertUsers([
      {
        userId: "invader",
        username: "Invader",
        villageId: "invaders",
        sector: 123,
        longitude: 19,
        latitude: 19,
        location: "Village",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        experience: 3339000,
        curHealth: 1000,
        maxHealth: 1000,
        curChakra: 1000,
        maxChakra: 1000,
        curStamina: 1000,
        maxStamina: 1000,
      },
    ]);
    await enrollCurrent();
    await shift();
    const ownerBefore = await load();
    const invader = callerForDatabase(villageDutyRouter, "invader", db);
    const first = await invader.patrol({ sector: 123 });
    expect(first.success).toBe(true);
    let stored = (await findVillageDutyShift(db, "home"))!;
    expect(stored.patrols[0]?.pursuit?.targetUserId).toBe("invader");
    expect(first.patrolUpdate?.patrols[0]?.pursuit?.expiresAt).toBe(
      stored.patrols[0]?.pursuit?.expiresAt,
    );
    if (!first.battleId) {
      const patrols = stored.patrols.map((entry) => ({
        ...entry,
        pursuit: entry.pursuit
          ? {
              ...entry.pursuit,
              startedAt: Date.now() - entry.pursuit.path.length * WANDER_STEP_MS - 1000,
            }
          : null,
      }));
      await db
        .update(villageDutyShift)
        .set({ patrols })
        .where(eq(villageDutyShift.villageId, "home"));
    }
    const admission = first.battleId ? first : await invader.patrol({ sector: 123 });
    expect(admission.success, admission.message).toBe(true);
    expect(admission.battleId).toBeDefined();
    const fight = (await db.query.battle.findFirst({
      where: eq(battle.id, admission.battleId!),
    }))!;
    expect(fight.extraState.villageDuty?.userId).toBe("protector");
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    for (const user of fight.usersState) if (user.isVillageDutyCopy) user.curHealth = 0;
    await db
      .update(battle)
      .set({ usersState: fight.usersState })
      .where(eq(battle.id, fight.id));
    await callerForDatabase(combatRouter, "invader", db).getBattle({
      battleId: fight.id,
    });
    stored = (await findVillageDutyShift(db, "home"))!;
    expect(stored.patrols[0]?.defeated).toBe(true);
    expect(stored.patrols[0]?.battleId).toBeNull();
    expect(await listVillageDutyPatrols(db, 123)).toEqual([]);
    expect(await load()).toEqual(ownerBefore);
    const after = await invader.patrol({ sector: 123 });
    expect(after.battleId).toBeUndefined();
  });

  it.each([
    ["VILLAGE_PROTECTOR", false, false, 0],
    ["SHRINE_WAR", false, false, 2],
    ["VILLAGE_PROTECTOR", true, false, 0],
    ["SHRINE_WAR", true, false, 2],
    ["VILLAGE_PROTECTOR", true, true, 2],
    ["SHRINE_WAR", true, true, 0],
  ] as const)(
    "%s awards PvP points once: copy wins=%s, rotated=%s, repeats=%s",
    async (battleType, copyWins, rotated, repeats) => {
      const db = await getTestDatabase();
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      await insertDefaultAiProfile();
      await db
        .insert(village)
        .values({ id: "invaders", name: "Invaders", sector: 456, kageId: "invader" });
      await db.insert(villageAlliance).values({
        id: "hostile",
        villageIdA: "home",
        villageIdB: "invaders",
        status: "ENEMY",
      });
      await insertUsers([
        {
          userId: "invader",
          username: "Invader",
          villageId: "invaders",
          sector: 123,
          longitude: 19,
          latitude: 19,
          location: "Village",
          status: "AWAKE",
          rank: "JONIN",
          level: 50,
          experience: 3339000,
          curHealth: 1000,
          maxHealth: 1000,
          curChakra: 1000,
          maxChakra: 1000,
          curStamina: 1000,
          maxStamina: 1000,
        },
      ]);
      await enrollCurrent();
      const active = await shift();
      if (repeats)
        await db.insert(battleHistory).values(
          Array.from({ length: repeats }, (_, index) => ({
            battleId: `prior-${index}`,
            battleType,
            attackedId: "invader",
            defenderId: "duty:protector",
          })),
        );
      const admission = await initiateVillageDutyBattle(
        {
          client: db,
          userIds: ["invader"],
          sector: 123,
          longitude: 19,
          latitude: 19,
          forceDefenderVillageId: "home",
          shift: active,
          slot: 0,
        },
        battleType,
      );
      expect(admission.success, admission.message).toBe(true);
      if (!("battleId" in admission) || !admission.battleId)
        throw new Error(admission.message);
      const fight = (await db.query.battle.findFirst({
        where: eq(battle.id, admission.battleId!),
      }))!;
      expect(fight.extraState.pvpExperienceScaling).toBe(1 / (repeats + 1));
      for (const user of fight.usersState)
        user.curHealth = !!user.isVillageDutyCopy === copyWins ? 1000 : 0;
      await db
        .update(battle)
        .set({ usersState: fight.usersState, extraState: fight.extraState })
        .where(eq(battle.id, fight.id));
      // Concurrent real-account progress and activity must survive an offline copy's payout.
      await db
        .update(userData)
        .set({
          pvpWins: 7,
          pvpLosses: 4,
          pvpExperience: 12.5,
          weeklyPvpKills: 9,
          weeklyPvpKillsAt: new Date("2025-01-01"),
          pvpStreak: 3,
          status: "ASLEEP",
          battleId: "separate-owner-battle",
          curHealth: 23,
          money: 451,
        })
        .where(eq(userData.userId, "protector"));
      const ownerBefore = (await load())!;
      if (rotated)
        await ensureVillageDutyShift(
          db,
          (await fetchVillageDutyHome(db, "home"))!,
          secondsFromDate(3600, active.startedAt),
        );
      const competing = holdReads(db, "battle", 2);
      const getBattle = () =>
        callerForDatabase(combatRouter, "invader", competing).getBattle({
          battleId: fight.id,
        });
      await Promise.all([getBattle(), getBattle()]);
      const ownerAfter = (await load())!;
      const xp = repeats ? 83.33 : 250;
      if (copyWins) {
        // Long-tenured owners retain the normal five-percent PvP loyalty bonus.
        const ownerXp = repeats ? 87.5 : 262.5;
        expect(ownerAfter).toMatchObject({
          pvpWins: 8,
          pvpLosses: 4,
          pvpExperience: 12.5 + ownerXp,
          weeklyPvpKills: 1,
          pvpStreak: 3,
        });
        expect(ownerAfter).toEqual({
          ...ownerBefore,
          pvpWins: 8,
          pvpExperience: 12.5 + ownerXp,
          weeklyPvpKills: 1,
          weeklyPvpKillsAt: ownerAfter.weeklyPvpKillsAt,
        });
      } else expect(ownerAfter).toEqual(ownerBefore);
      const invader = (await db.query.userData.findFirst({
        where: eq(userData.userId, "invader"),
      }))!;
      expect(invader).toMatchObject({
        pvpWins: copyWins ? 0 : 1,
        pvpLosses: copyWins ? 1 : 0,
        pvpExperience: copyWins ? (repeats ? 33.33 : 100) : xp,
        weeklyPvpKills: copyWins ? 0 : 1,
      });
      expect(
        await db.query.battle.findFirst({ where: eq(battle.id, fight.id) }),
      ).toBeUndefined();
      const finalShift = (await findVillageDutyShift(db, "home"))!;
      expect(finalShift.startedAt).toEqual(
        rotated ? secondsFromDate(3600, active.startedAt) : active.startedAt,
      );
      expect(finalShift.patrols[0]?.defeated).toBe(!copyWins);
    },
  );

  it.each([
    ["AWAKE", false],
    ["ASLEEP", false],
    ["AWAKE", true],
    ["ASLEEP", true],
  ] as const)(
    "intercepts direct PvP from %s (stealth=%s) before an invader can bypass live village protectors",
    async (status, stealthActive) => {
      const db = await getTestDatabase();
      vi.spyOn(sectorMaps, "fetchPublishedSectorMap").mockResolvedValue(
        sectorMap(20, 20, () => ({ zone: "village" }), { sector: 123, anchors: [] }),
      );
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      await insertDefaultAiProfile();
      await db
        .insert(village)
        .values({ id: "invaders", name: "Invaders", sector: 456, kageId: "invader" });
      await db.insert(villageAlliance).values({
        id: "hostile",
        villageIdA: "home",
        villageIdB: "invaders",
        status: "ENEMY",
      });
      await insertUsers([
        {
          userId: "invader",
          username: "Invader",
          villageId: "invaders",
          sector: 123,
          longitude: 5,
          latitude: 5,
          location: "Village",
          status,
          stealthActive,
          stealthActivatedAt: new Date(),
          autoWakeUp: true,
          rank: "JONIN",
          level: 50,
          experience: 3339000,
          curHealth: 1000,
          maxHealth: 1000,
          curChakra: 1000,
          maxChakra: 1000,
          curStamina: 1000,
          maxStamina: 1000,
        },
      ]);
      await db
        .update(userData)
        .set({
          longitude: 5,
          latitude: 5,
          rank: "JONIN",
          level: 50,
          experience: 3339000,
        })
        .where(eq(userData.userId, "protector"));
      await enrollCurrent();
      await shift();
      const result = await callerForDatabase(combatRouter, "invader", db).attackUser({
        sector: 123,
        longitude: 5,
        latitude: 5,
        userId: "protector",
      });
      expect(result.success, result.message).toBe(true);
      const fight = (await db.query.battle.findFirst({
        where: eq(battle.id, result.battleId!),
      }))!;
      expect(fight.battleType).toBe("VILLAGE_PROTECTOR");
      expect(
        fight.usersState.some((user) => user.controllerId === "duty:protector"),
      ).toBe(true);
      expect((await load())?.status).toBe("AWAKE");
      expect((await load())?.battleId).toBeNull();
    },
  );

  it.each(["active", "expired", "revealed", "missing activation"])(
    "respects %s stealth in travel snapshots and passive patrol admission",
    async (state) => {
      const db = await getTestDatabase();
      vi.spyOn(sectorMaps, "fetchPublishedSectorMap").mockResolvedValue(
        sectorMap(20, 20, () => ({ zone: "village" }), { sector: 123, anchors: [] }),
      );
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      await insertDefaultAiProfile();
      await db
        .insert(village)
        .values({ id: "invaders", name: "Invaders", sector: 456, kageId: "invader" });
      await db.insert(villageAlliance).values({
        id: "hostile",
        villageIdA: "home",
        villageIdB: "invaders",
        status: "ENEMY",
      });
      const stealth = 1000;
      await insertUsers([
        {
          userId: "invader",
          username: "Invader",
          villageId: "invaders",
          sector: 123,
          longitude: 19,
          latitude: 19,
          location: "Village",
          status: "AWAKE",
          rank: "JONIN",
          stealth,
          stealthActive: state !== "revealed",
          stealthActivatedAt:
            state === "missing activation"
              ? null
              : secondsFromDate(
                  state === "expired" ? -calcStealthDuration(stealth) - 1 : 0,
                  new Date(),
                ),
        },
      ]);
      await enrollCurrent();
      const before = await shift();
      const snapshot = await callerForDatabase(
        travelRouter,
        "invader",
        db,
      ).getSectorData({ sector: 123 });
      expect(snapshot.patrolThreat).toBe(state !== "active");
      const result = await callerForDatabase(villageDutyRouter, "invader", db).patrol({
        sector: 123,
      });
      expect(result.success, result.message).toBe(true);
      if (state === "active") {
        expect(result.battleId).toBeUndefined();
        expect(result.patrolUpdate).toBeUndefined();
        expect(await findVillageDutyShift(db, "home")).toEqual(before);
        expect(await listVillageDutyVisitors(db, 123, new Date())).toEqual([]);
      } else {
        expect(
          (await findVillageDutyShift(db, "home"))?.patrols[0]?.pursuit?.targetUserId,
        ).toBe("invader");
      }
    },
  );

  it("does not target a hidden visitor retained in shared presence while pursuing a visible enemy", async () => {
    const db = await getTestDatabase();
    await enrollCurrent();
    await shift();
    await db
      .insert(village)
      .values({ id: "invaders", name: "Invaders", sector: 456, kageId: "enemy" });
    await db.insert(villageAlliance).values({
      id: "hostile",
      villageIdA: "home",
      villageIdB: "invaders",
      status: "ENEMY",
    });
    await insertUsers([
      {
        userId: "hidden",
        username: "Hidden",
        villageId: "invaders",
        sector: 123,
        location: "Village",
        status: "AWAKE",
        longitude: 1,
        latitude: 1,
        stealthActive: true,
        stealthActivatedAt: new Date(),
      },
      {
        userId: "visible",
        username: "Visible",
        villageId: "invaders",
        sector: 123,
        location: "Village",
        status: "AWAKE",
        longitude: 19,
        latitude: 19,
      },
    ]);
    await touchVillageDutyPresence(db, "hidden", 123, secondsFromDate(25, new Date()));
    const [home, owners, presence, visitor] = await Promise.all([
      fetchVillageDutyHome(db, "home"),
      listVillageDutyRoster(db, "home"),
      listVillageDutyVisitors(db, 123, new Date()),
      db.query.userData.findFirst({ where: eq(userData.userId, "visible") }),
    ]);
    const advanced = await advanceVillageDutyPursuits(
      db,
      home!,
      owners,
      presence,
      sectorMap(20, 20, () => ({ zone: "village" }), { anchors: [] }),
      visitor!,
    );
    expect(advanced?.patrols[0]?.pursuit?.targetUserId).toBe("visible");
  });

  it.each(["before preload", "during cooking settlement", "before claim"])(
    "honors stealth activated %s and releases the reserved copy",
    async (timing) => {
      const db = await getTestDatabase();
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      await insertDefaultAiProfile();
      await insertUsers([
        {
          userId: "invader",
          username: "Invader",
          sector: 123,
          location: "Village",
          status: "AWAKE",
          rank: "JONIN",
          level: 50,
          experience: 3339000,
        },
      ]);
      await enrollCurrent();
      const active = await shift();
      const ownerBefore = await load();
      if (timing === "during cooking settlement")
        await db.insert(userCookingJob).values({
          id: "due-cooking",
          userId: "invader",
          experience: 30,
          finishesAt: secondsFromDate(-1, new Date()),
        });
      const activate = () =>
        db
          .update(userData)
          .set({ stealthActive: true, stealthActivatedAt: new Date() })
          .where(eq(userData.userId, "invader"));
      if (timing === "before preload") await activate();
      const activateDuringSettlement = vi.fn(activate);
      const guarded =
        timing === "during cooking settlement"
          ? beforeStatements(db, userCookingJob, [activateDuringSettlement], {
              operations: ["delete"],
            })
          : timing === "before claim"
            ? beforeStatements(db, userData, [activate], {
                when: (values) => values.status === "BATTLE",
              })
            : db;
      const result = await initiateVillageDutyBattle(
        {
          client: guarded,
          userIds: ["invader"],
          actionUserId: "invader",
          sector: 123,
          longitude: 0,
          latitude: 0,
          shift: active,
          slot: 0,
        },
        "VILLAGE_PROTECTOR",
      );
      expect(result.success).toBe(false);
      if (timing === "during cooking settlement") {
        expect(activateDuringSettlement).toHaveBeenCalledTimes(1);
        expect(result.message).toBe("Stealth keeps you hidden from this patrol.");
        expect(await db.query.userCookingJob.findMany()).toEqual([]);
      }
      const user = await db.query.userData.findFirst({
        where: eq(userData.userId, "invader"),
      });
      expect(user).toMatchObject({
        status: "AWAKE",
        battleId: null,
        stealthActive: true,
        pveFights: 0,
        cookingExperience: timing === "during cooking settlement" ? 30 : 0,
      });
      expect(await load()).toEqual(ownerBefore);
      expect((await findVillageDutyShift(db, "home"))?.patrols[0]).toMatchObject({
        defeated: false,
        battleId: null,
      });
      expect(await db.query.battle.findMany()).toEqual([]);
      expect(await db.query.battleHistory.findMany()).toEqual([]);
    },
  );
});
