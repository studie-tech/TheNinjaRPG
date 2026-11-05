import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData, userJutsu } from "@/drizzle/schema";
import { updateUserJutsuForUnequipAllJutsus } from "@/queries/staff";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("staff bulk unequip", () => {
  beforeEach(async () => {
    await resetTables(userJutsu, userData);
  });

  it("leaves AI users equipped", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "player" }, { userId: "npc", isAi: true }]);
    await db.insert(userJutsu).values([
      { id: "player-strike", userId: "player", jutsuId: "strike", equipped: true },
      { id: "npc-strike", userId: "npc", jutsuId: "strike", equipped: true },
    ]);
    await updateUserJutsuForUnequipAllJutsus(db);
    const equipped = await db
      .select({ userId: userJutsu.userId })
      .from(userJutsu)
      .where(eq(userJutsu.equipped, true));
    expect(equipped).toEqual([{ userId: "npc" }]);
  });
});
