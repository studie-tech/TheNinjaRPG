import { readFile } from "node:fs/promises";
import { expect, it } from "bun:test";
import type mysql from "mysql2/promise";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("home furniture inventory migration", () => {
  it("adds rooms and home sharing directly to the existing schema without changing account or inventory data", async () => {
    await withMigrationSandbox(
      {
        snapshot: "0086",
        baseline: ["UserData", "UserItem", "UserRequest"],
        created: ["UserHome"],
      },
      async ({ query }) => {
        await query(
          "INSERT INTO UserData (userId, username, gender, money, bank, homeFurnitureRevision) VALUES ('owner', 'Owner', 'Other', 123456, 654321, 7)",
        );
        await query(
          "INSERT INTO UserItem (id, userId, itemId, homeX, homeY) VALUES ('placed', 'owner', 'furniture', 50, 50), ('stored', 'owner', 'furniture', NULL, NULL)",
        );
        await query(
          "INSERT INTO UserRequest (id, senderId, receiverId, status, type) VALUES ('spar', 'owner', 'guest', 'PENDING', 'SPAR')",
        );
        const [accountsBefore] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserData",
        );
        const [inventoryBefore] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserItem ORDER BY id",
        );
        const [requestsBefore] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserRequest",
        );
        const migration = await readMigration("0087_tough_lady_vermin.sql");
        await query(migration);
        const [accounts] = await query<mysql.RowDataPacket[]>("SELECT * FROM UserData");
        expect(accounts).toEqual(accountsBefore);
        const [inventory] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserItem ORDER BY id",
        );
        expect(inventory.map(({ homeRoom, ...row }) => row)).toEqual(inventoryBefore);
        expect(inventory.every((row) => row.homeRoom === "main")).toBe(true);
        const [requests] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserRequest",
        );
        expect(requests.map(({ activeHomeReceiverId, ...row }) => row)).toEqual(
          requestsBefore,
        );
        expect(requests[0]!.activeHomeReceiverId).toBeNull();
        const [homes] = await query<mysql.RowDataPacket[]>("SELECT * FROM UserHome");
        expect(homes).toHaveLength(0);
        await query("INSERT INTO UserHome (userId) VALUES ('owner')");
        const [defaults] = await query<mysql.RowDataPacket[]>("SELECT * FROM UserHome");
        expect(
          defaults.map(({ userId, roomStyles, isPublic }) => ({
            userId,
            roomStyles,
            isPublic,
          })),
        ).toEqual([{ userId: "owner", roomStyles: [], isPublic: 0 }]);
        for (const room of [
          "main",
          ...Array.from({ length: 9 }, (_, index) => `room-${index + 1}`),
          "yard",
        ]) {
          await query(
            "INSERT INTO UserItem (id, userId, itemId, homeRoom) VALUES (?, 'owner', 'furniture', ?)",
            [room, room],
          );
        }
        await query(
          "INSERT INTO UserRequest (id, senderId, receiverId, status, type) VALUES ('invite', 'owner', 'guest', 'PENDING', 'HOME')",
        );
        await expect(
          query(
            "INSERT INTO UserRequest (id, senderId, receiverId, status, type) VALUES ('duplicate', 'owner', 'guest', 'ACCEPTED', 'HOME')",
          ),
        ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
        await query("UPDATE UserRequest SET status = 'REJECTED' WHERE id = 'invite'");
        await query(
          "INSERT INTO UserRequest (id, senderId, receiverId, status, type) VALUES ('accepted', 'owner', 'guest', 'ACCEPTED', 'HOME')",
        );
      },
    );
  }, 30_000);

  it("seeds ordinary furniture and grants starter copies without changing balances or existing inventory", async () => {
    await withMigrationSandbox(
      { snapshot: "0079", baseline: ["Item", "ItemVariant", "UserItem", "UserData"] },
      async ({ query, tables }) => {
        // Unique tables isolate the baseline schema. MySQL temporary tables cannot be
        // both the insert target and the inventory read used to skip existing starter copies.
        for (const [userId, homeType] of [
          ["resident", "PALACE"],
          ["fresh", "NONE"],
          ["u".repeat(191), "STUDIO_APARTMENT"],
        ]) {
          await query(
            "INSERT INTO UserData (userId, username, gender, homeType, money, bank) VALUES (?, ?, 'Other', ?, 100000, 54321)",
            [userId, userId, homeType],
          );
        }
        await query(
          "INSERT INTO Item (id, name, description, image, effects, itemType, rarity, slot, target) VALUES ('gear', 'Existing gear', 'Existing gear', '/gear.webp', JSON_ARRAY(), 'WEAPON', 'COMMON', 'ITEM', 'CHARACTER'); INSERT INTO UserItem (id, userId, itemId, quantity, level, experience, durability, equipped) VALUES ('owned-gear', 'resident', 'gear', 2, 7, 45, 55, 'ITEM_1');",
        );
        const migration = await readMigration("0080_curious_snowbird.sql");
        expect(migration).not.toMatch(/JSON_(EXTRACT|SEARCH|CONTAINS|SET)/i);
        const backfillStart = migration.indexOf("INSERT INTO `UserItem`");
        const backfillSql = migration.slice(backfillStart);
        await query(migration.slice(0, backfillStart));
        const catalogue = (await readFile("data/item.sql", "utf8")).split(
          "-- Furniture catalogue imports preserve content-team edits when repeated.",
        )[1]!;
        // Existing accounts receive only published furniture; a missing catalogue creates no rows.
        await query(backfillSql);
        const [unseededInventory] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserItem",
        );
        expect(unseededInventory).toHaveLength(1);
        await query(catalogue);
        // Registration uses independent row IDs; the backfill must preserve its starter copy.
        await query(
          "INSERT INTO UserItem (id, userId, itemId, quantity, equipped, storedAtHome, homeX, homeY) VALUES ('registered-bed', 'fresh', 'home-bed', 1, 'NONE', true, 35, 45)",
        );
        await query(backfillSql);
        const [columns] = await query<mysql.RowDataPacket[]>(
          "SHOW COLUMNS FROM UserData",
        );
        expect(
          columns
            .filter((column) => !tables.UserData!.columns[column.Field])
            .map((column) => column.Field),
        ).toEqual(["homeFurnitureRevision"]);
        const [inventory] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserItem",
        );
        expect(inventory).toHaveLength(13);
        expect(inventory.find((row) => row.id === "owned-gear")).toMatchObject({
          quantity: 2,
          level: 7,
          experience: 45,
          durability: 55,
          equipped: "ITEM_1",
          storedAtHome: 0,
          homeX: null,
          homeY: null,
        });
        expect(
          inventory
            .filter((row) => row.userId === "fresh")
            .map((row) => [row.itemId, row.homeX, row.homeY, row.homeRotation])
            .sort(),
        ).toEqual([
          ["home-armory", 75, 15.15, 0],
          ["home-bed", 35, 45, 0],
          ["home-garden", 86, 90.91, 0],
          ["home-kitchen", 76, 57.58, 0],
        ]);
        expect(
          inventory
            .filter((row) => row.id !== "owned-gear")
            .every(
              (row) =>
                (row.id.length === 64 || row.id === "registered-bed") &&
                row.quantity === 1 &&
                row.storedAtHome === 1 &&
                row.equipped === "NONE",
            ),
        ).toBe(true);
        await query(
          "UPDATE Item SET name = 'Staff Rug', cost = 33333 WHERE id = 'home-rug'; UPDATE UserItem SET homeX = 44, homeY = 66 WHERE userId = 'resident' AND itemId = 'home-bed';",
        );
        await query(catalogue);
        await query(backfillSql);
        const [retriedInventory] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM UserItem",
        );
        expect(retriedInventory).toHaveLength(13);
        expect(
          retriedInventory.find(
            (row) => row.userId === "resident" && row.itemId === "home-bed",
          ),
        ).toMatchObject({ homeX: 44, homeY: 66 });
        const [definitions] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM Item WHERE itemType = 'FURNITURE'",
        );
        expect(definitions).toHaveLength(15);
        expect(definitions.find((row) => row.id === "home-rug")).toMatchObject({
          name: "Staff Rug",
          cost: 33333,
          furnitureData: {
            action: null,
            width: 25,
            groundAnchor: 88.5417,
            isFloor: true,
          },
        });
        expect(definitions.filter((row) => row.cost === 0)).toHaveLength(7);
        expect(
          definitions
            .filter((row) => row.cost === 0)
            .every((row) => !row.inShop && !row.canBeTraded),
        ).toBe(true);
        const [residents] = await query<mysql.RowDataPacket[]>(
          "SELECT money, bank, homeFurnitureRevision FROM UserData",
        );
        expect(
          residents.every(
            (row) =>
              row.money === 100000 &&
              row.bank === 54321 &&
              row.homeFurnitureRevision === 0,
          ),
        ).toBe(true);
      },
    );
  }, 30_000);
});
