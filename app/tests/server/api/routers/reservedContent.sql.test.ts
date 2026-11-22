import { beforeEach, expect, it } from "bun:test";
import {
  IMG_AVATAR_DEFAULT,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
} from "@/drizzle/constants";
import {
  actionLog,
  bloodline,
  gameAsset,
  item,
  jutsu,
  quest,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import { RESERVED_CONTENT_IDS } from "@/libs/reservedContent";
import { deleteGameAssetForRollback } from "@/queries/contentReview";
import { gameAssetRouter } from "@/server/api/routers/asset";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { itemRouter } from "@/server/api/routers/item";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { profileRouter } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import {
  insertItems,
  insertJutsus,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const staffId = "reserved-content-staff";

/** Real reads stay available, while any cleanup, logging or transaction fails the test. */
const forbidWrites = (database: DrizzleClient): DrizzleClient =>
  new Proxy(database, {
    get(target, property, receiver) {
      if (
        ["insert", "update", "delete", "transaction", "execute"].includes(
          String(property),
        )
      )
        throw new Error(`Reserved deletion attempted a write: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });

describeWithDatabase("reserved content deletion guards", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      userItem,
      userJutsu,
      item,
      jutsu,
      quest,
      bloodline,
      gameAsset,
      userData,
    );
    await insertUsers([
      { userId: staffId, role: "CONTENT-ADMIN", username: "ReservedStaff" },
      ...RESERVED_CONTENT_IDS.ai.map((userId, index) => ({
        userId,
        username: `ReservedAi${index}`,
        isAi: true,
      })),
    ]);
    await insertItems(RESERVED_CONTENT_IDS.item.map((id) => ({ id })));
    await insertJutsus(RESERVED_CONTENT_IDS.jutsu.map((id) => ({ id })));
    await insertQuests(RESERVED_CONTENT_IDS.quest.map((id) => ({ id })));
    await insertUserItems([{ userId: staffId, itemId: TUTORIAL_ITEM_ID }]);
    const database = await getTestDatabase();
    await database.insert(userJutsu).values({
      id: "reserved-owned-jutsu",
      userId: staffId,
      jutsuId: TUTORIAL_JUTSU_ID,
    });
    await database.insert(bloodline).values(
      RESERVED_CONTENT_IDS.bloodline.map((id, index) => ({
        id,
        name: `Reserved Bloodline ${index}`,
        rank: "D" as const,
        image: IMG_AVATAR_DEFAULT,
        description: "Reserved",
        effects: [],
      })),
    );
    await database.insert(gameAsset).values(
      [...new Set(RESERVED_CONTENT_IDS.asset)].map((id, index) => ({
        id,
        name: `Reserved Asset ${index}`,
        image: IMG_AVATAR_DEFAULT,
        url: IMG_AVATAR_DEFAULT,
        type: "SFX" as const,
        folder: "",
      })),
    );
  });

  it("rejects every reserved definition before logging or removing dependent data", async () => {
    const database = forbidWrites(await getTestDatabase());
    const callers = {
      asset: callerForDatabase(gameAssetRouter, staffId, database),
      bloodline: callerForDatabase(bloodlineRouter, staffId, database),
      item: callerForDatabase(itemRouter, staffId, database),
      jutsu: callerForDatabase(jutsuRouter, staffId, database),
      quest: callerForDatabase(questsRouter, staffId, database),
      ai: callerForDatabase(profileRouter, staffId, database),
    };
    for (const type of [
      "asset",
      "bloodline",
      "item",
      "jutsu",
      "quest",
      "ai",
    ] as const) {
      for (const id of new Set(RESERVED_CONTENT_IDS[type])) {
        expect(await callers[type].delete({ id })).toEqual({
          success: false,
          message: expect.stringContaining("reserved content"),
        });
      }
    }
  });

  it("rejects database aliases of reserved IDs", async () => {
    const database = forbidWrites(await getTestDatabase());
    const caller = callerForDatabase(gameAssetRouter, staffId, database);
    for (const id of ["BODY", "bódy"]) {
      expect(await caller.delete({ id })).toMatchObject({ success: false });
    }
    expect(
      await callerForDatabase(itemRouter, staffId, database).delete({
        id: `${TUTORIAL_ITEM_ID.toUpperCase()} `,
      }),
    ).toMatchObject({ success: false, message: expect.stringContaining("reserved") });
  });

  it("allows ordinary staff-created definitions to be deleted", async () => {
    const database = await getTestDatabase();
    await database.insert(gameAsset).values({
      id: "ordinary-sound",
      name: "Ordinary sound",
      image: IMG_AVATAR_DEFAULT,
      url: IMG_AVATAR_DEFAULT,
      folder: "",
      type: "SFX",
    });
    expect(
      await (await callerFor(gameAssetRouter, staffId)).delete({
        id: "ordinary-sound",
      }),
    ).toMatchObject({ success: true });
    expect(
      await database.query.gameAsset.findFirst({
        where: (table, { eq }) => eq(table.id, "ordinary-sound"),
      }),
    ).toBeUndefined();
  });

  it("retains reserved assets when a content-review rollback removes an import batch", async () => {
    const database = await getTestDatabase();
    const ordinary = {
      id: "rollback-import",
      name: "Rollback import",
      image: IMG_AVATAR_DEFAULT,
      url: IMG_AVATAR_DEFAULT,
      type: "SFX" as const,
    };
    await database.insert(gameAsset).values(ordinary);
    const assets = await database.select().from(gameAsset);
    await deleteGameAssetForRollback(database, assets);
    const remaining = await database.select({ id: gameAsset.id }).from(gameAsset);
    expect(remaining.map(({ id }) => id).sort()).toEqual(
      [...new Set(RESERVED_CONTENT_IDS.asset)].sort(),
    );
  });
});
