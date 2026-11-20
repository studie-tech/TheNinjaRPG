import { expect, it } from "bun:test";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("welcome board migration", () => {
  it("adds board storage, review entity types and the recipient capacity index", async () => {
    await withMigrationSandbox(
      {
        snapshot: "0174",
        baseline: ["ContentProposalBasis", "ContentProposalChange", "WebStoreOrder"],
        created: ["SplashAnnouncement"],
      },
      async ({ query }) => {
        await query(await readMigration("0175_greedy_morph.sql"));
        const [board] = await query(
          "SELECT topicKey, enabled FROM SplashAnnouncement ORDER BY priority DESC",
        );
        expect(board).toEqual([
          expect.objectContaining({ topicKey: "tower-defense", enabled: 1 }),
          expect.objectContaining({ topicKey: "market-bundle-gifts", enabled: 1 }),
        ]);
        const [content] = await query(
          "SHOW COLUMNS FROM SplashAnnouncement LIKE 'content'",
        );
        expect(content).toHaveLength(0);
        await query(
          "UPDATE SplashAnnouncement SET enabled = false WHERE topicKey = 'tower-defense'",
        );
        const [archived] = await query(
          "SELECT topicKey FROM SplashAnnouncement WHERE enabled = false",
        );
        expect(archived).toEqual([
          expect.objectContaining({ topicKey: "tower-defense" }),
        ]);
        for (const table of ["ContentProposalBasis", "ContentProposalChange"]) {
          const [columns] = await query(`SHOW COLUMNS FROM ${table} LIKE 'entityType'`);
          expect(JSON.stringify(columns)).toContain("SPLASH");
        }
        const [indexes] = await query(
          "SHOW INDEX FROM WebStoreOrder WHERE Key_name = 'WebStoreOrder_recipient_bundle_idx'",
        );
        expect(indexes).toHaveLength(2);
      },
    );
  });
});
