import { readFile, writeFile } from "node:fs/promises";
import { validateElementClassificationMapping } from "../src/libs/elementClassificationMapping";
import { getFlagValue } from "./cli";

const mappingPath = getFlagValue(process.argv, "--mapping");
const catalogPath = getFlagValue(process.argv, "--catalog");
const outputPath = getFlagValue(process.argv, "--output");
if (!mappingPath || !catalogPath || !outputPath) {
  throw new Error("Usage: bun scripts/element-classification-backfill.ts --mapping mapping.json --catalog catalog.json --output backfill.sql");
}
const [mapping, catalog] = await Promise.all([
  readFile(mappingPath, "utf8").then(JSON.parse),
  readFile(catalogPath, "utf8").then(JSON.parse),
]);
const validated = validateElementClassificationMapping(mapping, catalog);
// Hex literals avoid dependence on SQL string escaping and NO_BACKSLASH_ESCAPES.
const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString("hex")}' USING utf8mb4)`;
const statements = ([ ["jutsus", "Jutsu"], ["items", "Item"] ] as const).flatMap(([kind, table]) =>
  validated[kind].map((row) =>
    `UPDATE \`${table}\` SET \`elements\` = ${literal(JSON.stringify(row.elements))}, \`updatedAt\` = CURRENT_TIMESTAMP(3) WHERE \`id\` = ${literal(row.id)};`,
  ),
);
await writeFile(outputPath, `${statements.join("\n")}\n`, { flag: "wx" });
console.log(`Wrote ${statements.length} classifications to ${outputPath}. No database changes applied.`);
