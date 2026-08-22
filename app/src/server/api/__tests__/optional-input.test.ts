// @vitest-environment node
//
// tRPC validates a procedure's input before the resolver runs. A top-level
// `z.object({...}).optional()` accepts a missing input but rejects an explicit
// `null`, which clients legitimately send for "no arguments" — that turned every
// such call into a BAD_REQUEST. `.nullish()` accepts both.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTERS_DIR = join(import.meta.dirname, "..", "routers");

/** `.input(z.object( ... ))` followed immediately by a bare `.optional()`. */
const findBareOptionalInputs = (source: string) => {
  const offenders: number[] = [];
  const opener = /\.input\(\s*z\.object\(/g;
  for (const match of source.matchAll(opener)) {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) {
          if (source.slice(i + 1).startsWith(".optional()")) {
            offenders.push(source.slice(0, match.index).split("\n").length);
          }
          break;
        }
      }
    }
  }
  return offenders;
};

const routerFiles = readdirSync(ROUTERS_DIR).filter((f) => f.endsWith(".ts"));

describe("tRPC procedure inputs", () => {
  it("has router files to check", () => {
    expect(routerFiles.length).toBeGreaterThan(0);
  });

  it.each(routerFiles)("%s uses .nullish() for optional inputs", (file) => {
    const lines = findBareOptionalInputs(readFileSync(join(ROUTERS_DIR, file), "utf8"));
    expect(
      lines,
      `${file} line(s) ${lines.join(", ")}: a top-level .input(z.object({...}).optional()) ` +
        "rejects an explicit null. Use .nullish() instead.",
    ).toEqual([]);
  });
});
