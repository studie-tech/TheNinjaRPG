import { expect, it } from "bun:test";
import type mysql from "mysql2/promise";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("pet skill recipient migration", () => {
  it("preserves tag order and payloads, moves the recipient choice to every tag and removes the shared column", async () => {
    await withMigrationSandbox(
      { snapshot: "0122", baseline: ["PetSpecies"] },
      async ({ query }) => {
        const effects = [
          {
            type: "decreasestat",
            power: 25,
            rounds: 100,
            generalTypes: ["Strength", "Speed"],
            target: "SELF",
          },
          {
            type: "increasestat",
            power: 30,
            rounds: 100,
            timeTracker: { owner: 2 },
            description: 'Escaped "words" and braces {}',
          },
          { type: "summon", aiId: "summon", power: 100 },
        ];
        for (const target of ["SELF", "ENEMIES"]) {
          for (const tags of [[], effects]) {
            const id = `${target}-${tags.length}`;
            await query(
              "INSERT INTO `PetSpecies` (id, name, description, skillTarget, effects) VALUES (?, ?, 'Species description', ?, ?)",
              [id, id, target, JSON.stringify(tags)],
            );
          }
        }
        const [before] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM `PetSpecies` ORDER BY id",
        );
        const migration = await readMigration("0123_pet_skill_targets.sql");
        await query(migration);
        const [after] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM `PetSpecies` ORDER BY id",
        );
        expect(after).toEqual(
          before.map(({ skillTarget, ...species }) => ({
            ...species,
            effects: species.effects.map((effect: object) => ({
              ...effect,
              skillTarget,
            })),
          })),
        );
        expect(after.every((species) => !("skillTarget" in species))).toBe(true);
      },
    );
  });
});
