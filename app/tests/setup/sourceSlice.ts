import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";

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
export const evaluateExpression = (
  expression: string,
  bindings: Record<string, unknown> = {},
) => {
  const code = transpiler
    .transformSync(`export const __value = (${expression});`)
    .replace(/export\s*\{[^}]*\};?/, "")
    .replace(/export\s+(const|var|let)\s+__value/, "$1 __value");
  return new Function(...Object.keys(bindings), `${code}\nreturn __value;`)(
    ...Object.values(bindings),
  );
};

const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const tokenCache = new Map<string, ReturnType<typeof parse>["tokens"]>();

const closingIndex = (source: string, open: number) => {
  const opening = source[open]!;
  const closing = closers[opening];
  if (!closing) throw new Error(`No bracket at ${open}`);
  let tokens = tokenCache.get(source);
  if (!tokens) {
    tokens = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      tokens: true,
    }).tokens!;
    tokenCache.set(source, tokens);
  }
  let depth = 0;
  for (const token of tokens) {
    if (token.start < open) continue;
    const label = token.type.label;
    if (label === opening || (opening === "{" && label === "${")) depth++;
    else if (label === closing && --depth === 0) return token.end - 1;
  }
  throw new Error(`Unclosed ${opening} at ${open}`);
};
