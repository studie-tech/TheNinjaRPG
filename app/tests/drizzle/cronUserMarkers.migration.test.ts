import { expect, it } from "bun:test";
import type mysql from "mysql2/promise";
import { executeRowsForGET10 } from "@/queries/cleaner";
import { updateUserDataForDailyCounters } from "@/queries/profile";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase, getTestDatabase } from "../setup/testDatabase";

describeWithDatabase("daily UserData markers migration", () => {
  it("resets existing players once on migration day while new accounts start current", async () => {
    await withMigrationSandbox(
      { snapshot: "0161", baseline: ["UserData"] },
      async ({ query }) => {
        await query("SET timestamp = UNIX_TIMESTAMP('2026-01-02 12:00:00')");
        const insert =
          "INSERT INTO UserData (userId, username, gender, dailyArenaFights, villagePrestige, tavernMessages) VALUES (?, ?, 'Male', 7, 10, 40)";
        await query(insert, ["existing", "existing"]);
        await query(await readMigration("0162_pink_ulik.sql"));
        await query(insert, ["new", "new"]);

        const db = await getTestDatabase();
        const dayStart = new Date("2026-01-02T00:00:00Z");
        const batch = ["existing", "new"];
        // Run the real guarded writes twice: migration-day eligibility must survive retries.
        for (let attempt = 0; attempt < 2; attempt++) {
          for (const statement of [
            updateUserDataForDailyCounters(db, dayStart, batch),
            executeRowsForGET10(db, dayStart, batch),
          ]) {
            const { sql, params } = statement.toSQL();
            await query(sql, params);
          }
        }
        const [rows] = await query<mysql.RowDataPacket[]>(
          "SELECT userId, dailyArenaFights, villagePrestige, tavernMessages FROM UserData ORDER BY userId",
        );
        expect(rows as unknown).toEqual([
          {
            userId: "existing",
            dailyArenaFights: 0,
            villagePrestige: 11,
            tavernMessages: 38,
          },
          {
            userId: "new",
            dailyArenaFights: 7,
            villagePrestige: 10,
            tavernMessages: 40,
          },
        ]);
      },
    );
  });
});
