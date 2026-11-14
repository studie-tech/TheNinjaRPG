import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = join(import.meta.dirname, "../../src");

/** Light-only surfaces and text that glare or vanish in the dark layouts. */
const lightOnly =
  /(?<![\w:/-])(bg-white|bg-(?:gray|slate)-[1-3]00|text-black)(?![\w/-])/g;

/**
 * Shared panels that follow the layout palette. Each entry lists the exact matches that
 * carry game meaning, such as effect colours, and may stay light.
 */
const themedFiles: Record<string, string[]> = {
  "components/ui/button.tsx": [],
  "layout/ClanSearchSelect.tsx": [],
  "layout/CombatHistory.tsx": [],
  "layout/CombatTimeline.tsx": ['gray: "bg-gray-100"'],
  "layout/Pagination.tsx": [],
  "layout/UserSearchSelect.tsx": [],
};

describe("themed surfaces", () => {
  for (const [file, allowed] of Object.entries(themedFiles)) {
    it(`${file} uses theme tokens for neutral surfaces`, () => {
      const offending = readFileSync(join(source, file), "utf8")
        .split("\n")
        .filter((line) => line.match(lightOnly))
        .map((line) => line.trim())
        .filter((line) => !allowed.some((entry) => line.includes(entry)));
      expect(offending).toEqual([]);
    });
  }
});
