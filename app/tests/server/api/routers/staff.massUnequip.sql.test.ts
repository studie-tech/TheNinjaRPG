import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  item,
  itemLoadout,
  jutsuLoadout,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import { staffRouter } from "@/server/api/routers/staff";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const staffId = "mass-unequip-staff";
const playerId = "mass-unequip-player";
const aiId = "mass-unequip-ai";

describeWithDatabase("staff mass unequip audit", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(
      actionLog,
      jutsuLoadout,
      itemLoadout,
      userJutsu,
      userItem,
      item,
      userData,
    );
    await insertUsers([
      { userId: staffId, username: "AuditStaff", role: "OWNER" },
      { userId: playerId, username: "AuditPlayer" },
      { userId: aiId, username: "AuditAi", isAi: true },
    ]);
    stubProfile("fetchUser", async (_client: unknown, id: string) =>
      db.query.userData.findFirst({ where: eq(userData.userId, id) }),
    );
  });

  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("logs the staff member and affected row counts for unequip all jutsu", async () => {
    const db = await getTestDatabase();
    await db.insert(userJutsu).values([
      { id: "uj-player-1", userId: playerId, jutsuId: "j1", equipped: true },
      { id: "uj-player-2", userId: playerId, jutsuId: "j2", equipped: true },
      { id: "uj-player-3", userId: playerId, jutsuId: "j3", equipped: false },
      { id: "uj-ai", userId: aiId, jutsuId: "j1", equipped: true },
    ]);
    await db.insert(jutsuLoadout).values([
      { id: "jl-player", userId: playerId, name: "Main", jutsuIds: ["j1", "j2"] },
      { id: "jl-ai", userId: aiId, name: "AI", jutsuIds: ["j1"] },
    ]);

    const result = await (await callerFor(staffRouter, staffId)).unequipAllJutsus();
    expect(result.success).toBe(true);

    const logs = await db.query.actionLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: staffId,
      tableName: "userJutsu",
      relatedMsg: "Mass unequip all jutsu by AuditStaff",
      changes: [
        "Mass unequip all jutsu for all non-AI users",
        "UserJutsu rows unequipped: 2",
        "JutsuLoadout rows cleared: 1",
      ],
    });
    const aiJutsu = await db.query.userJutsu.findFirst({
      where: eq(userJutsu.id, "uj-ai"),
    });
    expect(aiJutsu?.equipped).toBe(true);
  });

  it("logs the staff member and affected row counts for unequip all gear", async () => {
    const db = await getTestDatabase();
    await insertItems([{ id: "audit-armor", itemType: "ARMOR", slot: "CHEST" }]);
    await insertUserItems([
      { id: "ui-player", userId: playerId, itemId: "audit-armor", equipped: "CHEST" },
      { id: "ui-ai", userId: aiId, itemId: "audit-armor", equipped: "CHEST" },
    ]);
    await db.insert(itemLoadout).values([
      {
        id: "il-player",
        userId: playerId,
        name: "Main",
        itemData: [{ userItemId: "ui-player", itemId: "audit-armor", slot: "CHEST" }],
      },
      {
        id: "il-ai",
        userId: aiId,
        name: "AI",
        itemData: [{ userItemId: "ui-ai", itemId: "audit-armor", slot: "CHEST" }],
      },
    ]);

    const result = await (await callerFor(staffRouter, staffId)).unequipAllGear();
    expect(result.success).toBe(true);

    const logs = await db.query.actionLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: staffId,
      tableName: "userItem",
      relatedMsg: "Mass unequip all gear by AuditStaff",
      changes: [
        "Mass unequip all gear for all non-AI users",
        "UserItem rows unequipped: 1",
        "ItemLoadout rows cleared: 1",
      ],
    });
  });
});
