import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { jutsu, jutsuLoadout, userData, userJutsu } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertJutsus, insertUsers, jutsuRow } from "../../../../setup/factories";
import { aroundStatements, beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "loadout-switcher";

const loadoutIds = async (id: string) =>
  (
    await (
      await getTestDatabase()
    ).query.jutsuLoadout.findFirst({ where: eq(jutsuLoadout.id, id) })
  )?.jutsuIds;
const isEquipped = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned") })
  )?.equipped;

/** Equipping writes the jutsu row, then the active loadout; switching loadouts in between must not split them. */
describeWithDatabase("jutsu equip racing a loadout switch", () => {
  beforeEach(async () => {
    await resetTables(jutsuLoadout, userJutsu, jutsu, userData);
    await insertUsers([
      {
        userId,
        username: "LoadoutSwitcher",
        rank: "JONIN",
        level: 50,
        status: "AWAKE",
        jutsuLoadout: "main",
      },
    ]);
    await insertJutsus([jutsuRow("strike")]);
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values([
      { id: "main", userId, jutsuIds: [] },
      { id: "other", userId, jutsuIds: [] },
    ]);
    await db
      .insert(userJutsu)
      .values({ id: "owned", userId, jutsuId: "strike", equipped: false });
  });

  /** Equip `owned` while the user switches to `other`, holding `otherIds`, just before the loadout append. */
  const equipDuringSwitch = async (otherIds: string[]) => {
    const db = await getTestDatabase();
    const raced = beforeStatements(
      db,
      jutsuLoadout,
      [
        async () => {
          await db
            .update(jutsuLoadout)
            .set({ jutsuIds: otherIds })
            .where(eq(jutsuLoadout.id, "other"));
          await db
            .update(userData)
            .set({ jutsuLoadout: "other" })
            .where(eq(userData.userId, userId));
        },
      ],
      { operations: ["update"] },
    );
    return callerForDatabase(jutsuRouter, userId, raced).toggleEquip({
      userJutsuId: "owned",
    });
  };

  it("does not append to a loadout that stopped being active and rolls the equip back", async () => {
    expect(await equipDuringSwitch([])).toMatchObject({
      success: false,
      message: "Failed to update loadout — please retry",
    });
    expect(await loadoutIds("main")).toEqual([]);
    expect(await isEquipped()).toBe(false);
  });

  it("keeps the equip when the newly active loadout already lists the jutsu", async () => {
    expect((await equipDuringSwitch(["strike"])).success).toBe(true);
    expect(await loadoutIds("main")).toEqual([]);
    expect(await isEquipped()).toBe(true);
  });

  it("does not roll back an equip once the newly active loadout lists the jutsu", async () => {
    const db = await getTestDatabase();
    let switched = false;
    const switching = beforeStatements(
      db,
      jutsuLoadout,
      [
        async () => {
          switched = true;
          await db
            .update(userData)
            .set({ jutsuLoadout: "other" })
            .where(eq(userData.userId, userId));
        },
      ],
      { operations: ["update"] },
    );
    // The rollback unequip lands after another request already listed the jutsu.
    const raced = aroundStatements(
      switching,
      userJutsu,
      async (run) => {
        if (switched)
          await db
            .update(jutsuLoadout)
            .set({ jutsuIds: ["strike"] })
            .where(eq(jutsuLoadout.id, "other"));
        return run();
      },
      { when: (values) => values.equipped === false },
    );
    expect(
      (
        await callerForDatabase(jutsuRouter, userId, raced).toggleEquip({
          userJutsuId: "owned",
        })
      ).success,
    ).toBe(true);
    expect(await loadoutIds("main")).toEqual([]);
    expect(await isEquipped()).toBe(true);
  });
});
