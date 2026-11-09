import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Run hook bodies from a component without mounting it, so a suite can exercise effect and
 * mutation logic whose component would otherwise need WebGL or globally persistent module
 * mocks. Slices end where the code's own brackets close, never at a neighbouring comment or
 * at a particular indentation.
 */
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
  transformSync(source: string): string;
};

/** Source of a file under `app/src`. */
export const readSource = (path: string) =>
  readFileSync(join(import.meta.dirname, "../../src", path), "utf8");

/**
 * The call that starts at the first match of `start`, through the bracket closing the first
 * `(` after the match and its `;`. Brackets inside strings, template literals and comments
 * are skipped.
 */
export const sliceCall = (source: string, start: RegExp) => {
  const match = start.exec(source);
  if (!match) throw new Error(`Source is missing ${start}`);
  const end = closingIndex(source, source.indexOf("(", match.index)) + 1;
  return source.slice(match.index, source[end] === ";" ? end + 1 : end);
};

/** The bracketed expression (object, array or parenthesised) that opens right after `start`. */
export const sliceExpressionAfter = (source: string, start: RegExp) => {
  const match = start.exec(source);
  if (!match) throw new Error(`Source is missing ${start}`);
  const open = match.index + match[0].length;
  return source.slice(open, closingIndex(source, open) + 1);
};

/** Transpile TypeScript statements and run them with `scope` standing in for their closure. */
export const runInScope = (code: string, scope: object) =>
  new Function("scope", `with (scope) { ${transpiler.transformSync(code)} }`)(scope);

/** Transpile a TypeScript expression and return its value, with `bindings` as free variables. */
export const evaluateExpression = (expression: string, bindings: Record<string, unknown> = {}) => {
  const code = transpiler.transformSync(`export const __value = (${expression});`)
    .replace(/export\s*\{[^}]*\};?/, "")
    .replace(/export\s+(const|var|let)\s+__value/, "$1 __value");
  return new Function(...Object.keys(bindings), `${code}\nreturn __value;`)(...Object.values(bindings));
};

const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

const closingIndex = (source: string, open: number) => {
  if (!(source[open]! in closers)) throw new Error(`No bracket at ${open}`);
  const expected: string[] = [];
  for (let index = open; index < source.length; index++) {
    const char = source[index]!;
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index);
      if (index < 0) break;
    } else if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2) + 1;
      if (index <= 0) break;
    } else if (char === '"' || char === "'") {
      index = quotedEnd(source, index, char);
    } else if (char === "`") {
      index = templateEnd(source, index);
    } else if (char in closers) {
      expected.push(closers[char]!);
    } else if (char === ")" || char === "]" || char === "}") {
      if (expected.pop() !== char) throw new Error(`Unbalanced ${char} at ${index}`);
      if (expected.length === 0) return index;
    }
  }
  throw new Error(`Unclosed ${source[open]} at ${open}`);
};

const quotedEnd = (source: string, start: number, quote: string) => {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") index++;
    else if (source[index] === quote) return index;
  }
  throw new Error(`Unclosed string at ${start}`);
};

const templateEnd = (source: string, start: number) => {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") index++;
    else if (source[index] === "`") return index;
    else if (source[index] === "$" && source[index + 1] === "{") index = closingIndex(source, index + 1);
  }
  throw new Error(`Unclosed template at ${start}`);
};
