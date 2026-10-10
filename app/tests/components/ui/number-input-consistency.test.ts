import { describe, expect, it } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Numeric controls share draft handling and cannot reintroduce eager parsing.
describe("numeric input consistency", () => {
  it("uses NumberInput for every explicitly numeric control", async () => {
    const sourceRoot = fileURLToPath(new URL("../../../src", import.meta.url));
    const violations: string[] = [];
    for (const file of await readdir(sourceRoot, { recursive: true })) {
      if (!file.endsWith(".tsx")) continue;
      if (file === "components/ui/number-input.tsx") continue;
      const source = await readFile(join(sourceRoot, file), "utf8");
      if (/\btype\s*=\s*["']number["']/.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
