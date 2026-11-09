import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  anbuSquad,
  userData,
  village,
  villageAlliance,
  war,
  warAlly,
  warMercenary,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { stealthRouter } from "@/server/api/routers/stealth";
import { defaultWarRules } from "@/validators/war";
import { insertUsers } from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const SECTOR = 101;

const hidden = (
  userId: string,
  villageId: string,
  patch: Partial<typeof userData.$inferInsert> = {},
) => ({
  userId,
  username: userId,
  villageId,
  status: "AWAKE" as const,
  rank: "JONIN" as const,
  level: 40,
  sector: SECTOR,
  stealthActive: true,
  stealthActivatedAt: new Date(),
  ...patch,
});

describeWithDatabase("sensory reveals", () => {
  beforeEach(async () => {
    await resetTables(
      warMercenary,
      warAlly,
      war,
      anbuSquad,
      villageAlliance,
      village,
      userData,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home", name: "Home", sector: 1, kageId: "home-kage" },
      { id: "foe", name: "Foe", sector: 2, kageId: "foe-kage" },
      { id: "support", name: "Support", sector: 3, kageId: "support-kage" },
      { id: "treaty", name: "Treaty", sector: 4, kageId: "treaty-kage" },
      { id: "outsider", name: "Outsider", sector: 5, kageId: "outsider-kage" },
    ]);
    await db
      .insert(villageAlliance)
      .values({ id: "pact", villageIdA: "home", villageIdB: "treaty", status: "ALLY" });
    await insertUsers([hidden("scout", "home", { stealthActive: false })]);
  });
  afterEach(() => vi.restoreAllMocks());

  const startWar = async () => {
    const db = await getTestDatabase();
    await db.insert(war).values({
      id: "w",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
      attackerVillageId: "home",
      defenderVillageId: "foe",
      combatStartedAt: new Date(Date.now() - 3600000),
      rules: defaultWarRules,
      objectiveState: { attackerEspionage: 0, defenderEspionage: 0, objectives: [] },
    });
  };
  const hire = async (userId: string, sideVillageId: string, slot = 0) => {
    const db = await getTestDatabase();
    await db.insert(warMercenary).values({
      id: `contract-${userId}`,
      warId: "w",
      sideVillageId,
      userId,
      invitedById: `${sideVillageId}-kage`,
      tokens: 0,
      slot,
      acceptedAt: new Date(),
    });
  };
  const scan = async () => {
    const db = await getTestDatabase();
    const result = await callerForDatabase(stealthRouter, "scout", db).useSensory({
      sector: SECTOR,
    });
    expect(result.success, result.message).toBe(true);
    return result.data?.detectedUsers ?? [];
  };

  it("returns the public identity of an unmasked enemy", async () => {
    await insertUsers([hidden("open", "foe")]);
    expect(await scan()).toEqual([
      expect.objectContaining({
        userId: "open",
        username: "open",
        villageId: "foe",
        level: 40,
        isMasked: false,
        canAttack: true,
      }),
    ]);
  });

  it("hides the identity of a war mercenary", async () => {
    await startWar();
    await insertUsers([hidden("merc", "outsider", { username: "real-name" })]);
    await hire("merc", "foe");
    const [detected] = await scan();
    expect(detected).toEqual(
      expect.objectContaining({
        userId: "merc",
        username: "Mercenary",
        villageId: null,
        level: null,
        isMasked: true,
        canAttack: true,
      }),
    );
    expect(JSON.stringify(detected)).not.toContain("real-name");
    expect(JSON.stringify(detected)).not.toContain("outsider");
  });

  it("hides the identity of enemy ANBU", async () => {
    const db = await getTestDatabase();
    await db.insert(anbuSquad).values([
      {
        id: "foe-squad",
        name: "foe-squad",
        image: "squad.webp",
        villageId: "foe",
        kageOrderId: "foe-kage",
        leaderOrderId: "foe-kage",
      },
    ]);
    await insertUsers([
      hidden("agent", "foe", { username: "real-name", anbuId: "foe-squad" }),
    ]);
    expect(await scan()).toEqual([
      expect.objectContaining({
        username: "ANBU Member",
        villageId: null,
        level: null,
        isMasked: true,
      }),
    ]);
  });

  it("reveals a war enemy from the viewer's own or allied village", async () => {
    await startWar();
    await insertUsers([hidden("turncoat", "home"), hidden("defector", "treaty")]);
    await hire("turncoat", "foe");
    await hire("defector", "foe", 1);
    const detected = await scan();
    expect(detected.map((user) => user.userId).sort()).toEqual([
      "defector",
      "turncoat",
    ]);
    expect(detected.every((user) => user.canAttack && user.isMasked)).toBe(true);
    const db = await getTestDatabase();
    const turncoat = await db.query.userData.findFirst({
      where: eq(userData.userId, "turncoat"),
    });
    expect(turncoat?.stealthActive).toBe(false);
  });

  it("leaves peacetime allies and war-side supporters hidden", async () => {
    await startWar();
    const db = await getTestDatabase();
    await db.insert(warAlly).values({
      id: "backing",
      warId: "w",
      villageId: "support",
      supportVillageId: "home",
      tokensPaid: 0,
    });
    await insertUsers([
      hidden("neighbour", "home"),
      hidden("pact-member", "treaty"),
      hidden("supporter", "support"),
    ]);
    expect(await scan()).toEqual([]);
    const supporter = await db.query.userData.findFirst({
      where: eq(userData.userId, "supporter"),
    });
    expect(supporter?.stealthActive).toBe(true);
  });

  it("offers no attack on a target the server would refuse", async () => {
    await insertUsers([
      hidden("student", "foe", { rank: "STUDENT" }),
      hidden("fighting", "foe", { status: "BATTLE" }),
      hidden("banned", "foe", { isBanned: true }),
      hidden("fair", "foe"),
    ]);
    const detected = await scan();
    expect(
      Object.fromEntries(detected.map((user) => [user.userId, user.canAttack])),
    ).toEqual({ student: false, fighting: false, banned: false, fair: true });
  });
});
