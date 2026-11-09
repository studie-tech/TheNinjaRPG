import { expect, it } from "bun:test";
import type mysql from "mysql2/promise";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("Discord link slots migration", () => {
  it("makes existing links primary in slot 1 and keeps inserts without a slot unique", async () => {
    await withMigrationSandbox(
      { snapshot: "0112", baseline: ["DiscordLink"] },
      async ({ query }) => {
        // Columns as written before slots existed.
        const insert = (id: string, userId: string, slot?: number) =>
          query(
            `INSERT INTO DiscordLink (id, userId, discordId, discordUsername, discordCreatedAt, scopes${slot ? ", slot" : ""}) VALUES (?, ?, '175928847299117063', 'naruto_fan', NOW(3), 'identify'${slot ? ", ?" : ""})`,
            slot ? [id, userId, slot] : [id, userId],
          );
        await insert("live", "user-a");
        const migration = await readMigration("0114_discord_two_characters.sql");
        // The new key exists before the old one is dropped, so uniqueness never lapses.
        expect(migration.indexOf("DiscordLink_discordId_slot_key")).toBeLessThan(
          migration.indexOf("DROP INDEX `DiscordLink_discordId_key`"),
        );
        await query(migration);
        const [rows] = await query<mysql.RowDataPacket[]>(
          "SELECT id, slot, isPrimary FROM DiscordLink",
        );
        expect(rows as unknown).toEqual([{ id: "live", slot: 1, isPrimary: 1 }]);
        // Code that predates slots inserts into slot 1, so it still links a Discord account once.
        await expect(insert("old-code", "user-b")).rejects.toThrow(/Duplicate entry/);
        await insert("second", "user-b", 2);
        await expect(insert("third", "user-c", 2)).rejects.toThrow(/Duplicate entry/);
      },
    );
  });
});
