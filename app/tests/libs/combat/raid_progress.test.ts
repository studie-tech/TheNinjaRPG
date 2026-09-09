// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  notification,
  quest,
  raidParticipation,
  userData,
} from "@/drizzle/schema";
import { updateRaidProgress } from "@/libs/combat/database";
import type { CompleteBattle } from "@/libs/combat/types";
import { insertQuests, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";

const USER_ID = "raid-user";
const QUEST_ID = "raid-quest-1";

const raidBattle = (
  overrides: {
    battleType?: CompleteBattle["battleType"];
    raidQuestId?: string;
    raidInitialBossHp?: number;
    raidStartBattleCount?: Record<string, number>;
    bossHealth?: number;
    extraUsers?: ReturnType<typeof makeBattleUser>[];
  } = {},
): CompleteBattle =>
  makeCompleteBattle({
    battleType: overrides.battleType ?? "RAID",
    extraState: {
      raidQuestId: overrides.raidQuestId ?? QUEST_ID,
      raidInitialBossHp: overrides.raidInitialBossHp ?? 1000,
      raidStartBattleCount: overrides.raidStartBattleCount ?? { [USER_ID]: 0 },
    },
    usersState: [
      makeBattleUser(USER_ID, { isAi: false, isSummon: false }),
      makeBattleUser("raid-boss", {
        isAi: true,
        isSummon: false,
        curHealth: overrides.bossHealth ?? 0,
      }),
      ...(overrides.extraUsers ?? []),
    ],
  });

type RaidProgressClientOptions = {
  upsertRowsAffected: number;
  bossHpAfterDecrement: number;
};

const createRaidProgressClient = ({
  upsertRowsAffected,
  bossHpAfterDecrement,
}: RaidProgressClientOptions) => {
  const calls: string[] = [];
  const findMany = vi.fn(async () => {
    calls.push("fetchParticipants");
    return [{ userId: USER_ID }];
  });
  const findFirst = vi.fn(async () => {
    calls.push("fetchHp");
    return { raidBossCurrentHealth: bossHpAfterDecrement, name: "Test Raid" };
  });
  const notificationValues = vi.fn(async () => {
    calls.push("notify");
    return { rowsAffected: 1 };
  });
  const onDuplicateKeyUpdate = vi.fn(async () => {
    calls.push("upsert");
    return { rowsAffected: upsertRowsAffected };
  });
  const participationValues = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
  const questWhere = vi.fn(async () => {
    calls.push("hp");
    return { rowsAffected: 1 };
  });
  const unreadWhere = vi.fn(async () => {
    calls.push("unread");
    return { rowsAffected: 1 };
  });

  const client = {
    insert: vi.fn((table: unknown) => {
      if (table === raidParticipation) {
        return {
          values: participationValues,
        };
      }
      if (table === notification) {
        return { values: notificationValues };
      }
      throw new Error("unexpected insert");
    }),
    update: vi.fn((table: unknown) => {
      if (table === quest) {
        return { set: vi.fn().mockReturnValue({ where: questWhere }) };
      }
      if (table === userData) {
        return { set: vi.fn().mockReturnValue({ where: unreadWhere }) };
      }
      throw new Error("unexpected update");
    }),
    query: {
      quest: { findFirst },
      raidParticipation: { findMany },
    },
  };

  return {
    client: client as never,
    calls,
    findMany,
    findFirst,
    notificationValues,
    participationValues,
  };
};

describe("updateRaidProgress", () => {
  it("does not write when the battle is not a raid", async () => {
    const { client, calls } = createRaidProgressClient({
      upsertRowsAffected: 1,
      bossHpAfterDecrement: 0,
    });

    await updateRaidProgress(client, raidBattle({ battleType: "COMBAT" }), USER_ID);

    expect(calls).toEqual([]);
  });

  it("does not write when the boss took no damage", async () => {
    const { client, calls } = createRaidProgressClient({
      upsertRowsAffected: 1,
      bossHpAfterDecrement: 0,
    });

    await updateRaidProgress(
      client,
      raidBattle({ raidInitialBossHp: 1000, bossHealth: 1000 }),
      USER_ID,
    );

    expect(calls).toEqual([]);
  });

  it("stops after a lost battleCount claim and does not decrement HP or notify", async () => {
    const { client, calls, findMany } = createRaidProgressClient({
      upsertRowsAffected: 0,
      bossHpAfterDecrement: 0,
    });

    await updateRaidProgress(client, raidBattle(), USER_ID);

    expect(calls).toEqual(["upsert"]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("decrements HP after a successful claim and skips notify while the boss lives", async () => {
    const { client, calls, findMany } = createRaidProgressClient({
      upsertRowsAffected: 1,
      bossHpAfterDecrement: 400,
    });

    await updateRaidProgress(client, raidBattle({ bossHealth: 400 }), USER_ID);

    expect(calls).toEqual(["upsert", "hp", "fetchHp"]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("notifies only after the post-decrement HP read, without scanning participants", async () => {
    const { client, calls, findMany, notificationValues } = createRaidProgressClient({
      upsertRowsAffected: 2,
      bossHpAfterDecrement: 0,
    });

    await updateRaidProgress(client, raidBattle(), USER_ID);

    expect(calls.slice(0, 3)).toEqual(["upsert", "hp", "fetchHp"]);
    expect([...calls.slice(3)].sort()).toEqual(["notify", "unread"]);
    expect(findMany).not.toHaveBeenCalled();
    expect(notificationValues).toHaveBeenCalledWith([
      {
        userId: USER_ID,
        content:
          "The boss in Test Raid has been defeated! Check if you've earned any rewards.",
      },
    ]);
  });

  it("splits battle damage evenly across human attackers and ignores summons", async () => {
    const { client, participationValues } = createRaidProgressClient({
      upsertRowsAffected: 1,
      bossHpAfterDecrement: 500,
    });

    await updateRaidProgress(
      client,
      raidBattle({
        extraUsers: [
          makeBattleUser("teammate", { isAi: false, isSummon: false }),
          makeBattleUser("pet", { isAi: true, isSummon: true }),
        ],
      }),
      USER_ID,
    );

    expect(participationValues).toHaveBeenCalledWith(
      expect.objectContaining({
        questId: QUEST_ID,
        userId: USER_ID,
        damageDealt: 500,
        battleCount: 1,
      }),
    );
  });
});

describeWithDatabase("updateRaidProgress against MySQL", () => {
  beforeEach(async () => {
    await resetTables(notification, raidParticipation, quest, userData);
  });

  const seedRaid = async (bossHp: number) => {
    await insertUsers([
      { userId: USER_ID, username: "RaidUser", unreadNotifications: 0 },
    ]);
    await insertQuests([
      {
        id: QUEST_ID,
        name: "Test Raid",
        questType: "raid",
        raidBossMaxHealth: 1000,
        raidBossCurrentHealth: bossHp,
      },
    ]);
    return getTestDatabase();
  };

  const readRaid = async () => {
    const database = await getTestDatabase();
    const [raid] = await database
      .select({
        raidBossCurrentHealth: quest.raidBossCurrentHealth,
      })
      .from(quest)
      .where(eq(quest.id, QUEST_ID));
    const participants = await database
      .select()
      .from(raidParticipation)
      .where(eq(raidParticipation.questId, QUEST_ID));
    const notices = await database
      .select()
      .from(notification)
      .where(eq(notification.userId, USER_ID));
    const [user] = await database
      .select({ unreadNotifications: userData.unreadNotifications })
      .from(userData)
      .where(eq(userData.userId, USER_ID));
    return { raid, participants, notices, user };
  };

  it("applies damage once and notifies once when a retry reuses the same battleCount", async () => {
    const database = await seedRaid(1000);
    const battle = raidBattle({ bossHealth: 0 });

    await updateRaidProgress(database, battle, USER_ID);
    await updateRaidProgress(database, battle, USER_ID);

    const { raid, participants, notices, user } = await readRaid();
    expect(raid?.raidBossCurrentHealth).toBe(0);
    expect(participants).toHaveLength(1);
    expect(participants[0]?.damageDealt).toBe(1000);
    expect(participants[0]?.battleCount).toBe(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.content).toMatch(/Test Raid/);
    expect(user?.unreadNotifications).toBe(1);
  });

  it("does not notify when the shared boss HP is still above zero", async () => {
    const database = await seedRaid(1000);
    await updateRaidProgress(
      database,
      raidBattle({ raidInitialBossHp: 1000, bossHealth: 600 }),
      USER_ID,
    );

    const { raid, participants, notices, user } = await readRaid();
    expect(raid?.raidBossCurrentHealth).toBe(600);
    expect(participants[0]?.damageDealt).toBe(400);
    expect(notices).toHaveLength(0);
    expect(user?.unreadNotifications).toBe(0);
  });
});
