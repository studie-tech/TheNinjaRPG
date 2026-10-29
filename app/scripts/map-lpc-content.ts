import { readFileSync, writeFileSync } from "node:fs";
import { inferItemColor, inferItemProfile, type SpriteItem } from "../src/libs/lpc/appearance";

/**
 * Write an ID-sorted visual mapping from a trusted exported item catalogue supplied as argv[2].
 * Review deliberate mappings before replacing the file; staff overrides remain in the database.
 */
const source = process.argv[2];
if (!source) throw new Error("Supply a JSON array of item IDs, names, slots, types and weapon types");
const items = JSON.parse(readFileSync(source, "utf8")) as (SpriteItem & { id: string })[];
const mappings = Object.fromEntries([...items].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [item.id, { name: item.name, profile: inferItemProfile(item), color: inferItemColor(item.name ?? "") ?? "gray" }]));
writeFileSync(new URL("../src/libs/lpc/content.json", import.meta.url), `${JSON.stringify(mappings, null, 2)}\n`);
console.log(`Mapped ${items.length} items`);
