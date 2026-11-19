import { expect, it } from "bun:test";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("welcome board migration", () => {
  it("adds board storage, review entity types and the recipient capacity index", async () => {
    await withMigrationSandbox(
      {
        snapshot: "0173",
        baseline: ["ContentProposalBasis", "ContentProposalChange", "WebStoreOrder"],
        created: ["SplashAnnouncement"],
      },
      async ({ query }) => {
        await query(await readMigration("0174_confused_venus.sql"));
        await query(
          "INSERT INTO SplashAnnouncement (id, content) VALUES ('welcome', JSON_OBJECT('name','Dispatch'))",
        );
        const [board] = await query(
          "SELECT JSON_UNQUOTE(JSON_EXTRACT(content, '$.name')) AS name FROM SplashAnnouncement",
        );
        expect(board).toEqual([expect.objectContaining({ name: "Dispatch" })]);
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
