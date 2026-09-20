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

/**
 * Blanks out string and template literals and comments so that parentheses inside
 * them - `z.string().default(")")` - do not throw the depth count off.
 */
const blankNonCode = (source: string) => {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    let close: string | undefined;
    let escapes = false;
    if (ch === '"' || ch === "'" || ch === "`") {
      close = ch;
      escapes = true;
    } else if (ch === "/" && next === "/") {
      close = "\n";
    } else if (ch === "/" && next === "*") {
      close = "*/";
    }
    if (!close) {
      i++;
      continue;
    }
    let j = i + (close.length > 1 || escapes ? 1 : 2);
    while (j < source.length) {
      if (escapes && source[j] === "\\") {
        j += 2;
        continue;
      }
      if (source.startsWith(close, j)) break;
      out[j] = " ";
      j++;
    }
    i = j + close.length;
  }
  return out.join("");
};

/** `.input(z.object( ... ))` followed immediately by a bare `.optional()`. */
const findBareOptionalInputs = (source: string) => {
  const offenders: number[] = [];
  const scannable = blankNonCode(source);
  const opener = /\.input\(\s*z\.object\(/g;
  for (const match of scannable.matchAll(opener)) {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < scannable.length; i++) {
      if (scannable[i] === "(") depth++;
      else if (scannable[i] === ")") {
        depth--;
        if (depth === 0) {
          if (/^\s*\.optional\(\)/.test(scannable.slice(i + 1))) {
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

describe("the optional-input scanner", () => {
  it("sees through a parenthesis inside a string literal", () => {
    expect(
      findBareOptionalInputs(
        '.input(z.object({ label: z.string().default(")") }).optional())',
      ),
    ).toEqual([1]);
  });

  it("accepts .nullish()", () => {
    expect(
      findBareOptionalInputs(".input(z.object({ label: z.string() }).nullish())"),
    ).toEqual([]);
  });

  it("ignores commented-out code", () => {
    expect(
      findBareOptionalInputs("// .input(z.object({ a: z.string() }).optional())"),
    ).toEqual([]);
  });

  it("sees .optional() on the next line", () => {
    expect(
      findBareOptionalInputs(".input(z.object({ a: z.string() })\n.optional())"),
    ).toEqual([1]);
  });

  it("reports the line the input starts on", () => {
    expect(
      findBareOptionalInputs("a\nb\n.input(z.object({ a: z.string() }).optional())"),
    ).toEqual([3]);
  });
});

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
