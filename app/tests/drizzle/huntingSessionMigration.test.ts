import { expect, it } from "bun:test";
import type mysql from "mysql2/promise";
import { huntingContract, huntingHabitatContent } from "../setup/hunting";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("accepted hunting terms migration", () => {
  it("backfills sessions and retains battle terms without losing unavailable sessions", async () => {
    await withMigrationSandbox(
      { snapshot: "0106", baseline: ["HuntingSession", "HuntingHabitat", "Battle"] },
      async ({ query }) => {
        const content = huntingHabitatContent();
        await query(
          "INSERT INTO HuntingHabitat (id, content, updatedAt) VALUES ('forest', ?, NOW(3))",
          [JSON.stringify(content)],
        );
        for (const [userId, habitatId, battleId] of [
          ["accepted", "forest", null],
          ["fighting", "forest", "fight"],
          ["missing-fighting", "removed", "fight"],
          ["missing", "removed", null],
        ]) {
          await query(
            "INSERT INTO HuntingSession (userId, id, habitatId, contractId, sector, battleId, startedAt) VALUES (?, ?, ?, 'contract', 1, ?, NOW(3))",
            [userId, userId, habitatId, battleId],
          );
        }
        const battleContract = {
          ...huntingContract(),
          name: "Accepted boar",
          experience: 123,
        };
        await query(
          "INSERT INTO Battle (id, background, battleType, usersState, usersEffects, groundEffects, extraState) VALUES ('fight', 'ground', 'HUNTING', '[]', '[]', '[]', ?)",
          [JSON.stringify({ hunting: { contract: battleContract } })],
        );
        const [before] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM HuntingSession ORDER BY userId",
        );
        const migration = await readMigration("0107_kind_sabra.sql");
        await query(migration);
        const [rows] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM HuntingSession ORDER BY userId",
        );
        expect(rows.map(({ content: _content, ...row }) => row)).toEqual(before);
        expect(rows.find((r) => r.userId === "accepted")!.content).toEqual(content);
        expect(rows.find((r) => r.userId === "fighting")!.content.contracts).toEqual([
          battleContract,
        ]);
        expect(rows.find((r) => r.userId === "missing-fighting")!.content).toEqual({
          contracts: [battleContract],
        });
        expect(rows.find((r) => r.userId === "missing")!.content).toBeNull();
      },
    );
  });
});
