import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";

/** Application source directory whose cache modules are checked. */
const sourceRoot = join(import.meta.dirname, "../../../../src");
/** The directory that holds the cache factories and every cache built from them. */
const cacheDirectory = join(sourceRoot, "server/utils/caches");
/** Factory modules, which build no cache of their own. */
const factoryModules = new Map([
  ["runtimeCache.ts", ["createRuntimeCache", "createRuntimeEntryCache"]],
  ["definitionCache.ts", ["createDefinitionCache"]],
]);
const factories = new Set([...factoryModules.values()].flat());
const factorySpecifiers = new Set(
  [...factoryModules.keys()].map(
    (name) => `@/server/utils/caches/${name.replace(/\.ts$/, "")}`,
  ),
);

type SyntaxNode = { type: string; [key: string]: unknown };

describe("cache module boundary", () => {
  it("builds caches only in the caches directory", () => {
    const violations = filesIn(sourceRoot)
      .filter((file) => !file.startsWith(`${cacheDirectory}/`))
      .flatMap((file) =>
        imports(file)
          .filter((specifier) => factorySpecifiers.has(specifier))
          .map((specifier) => `${relative(sourceRoot, file)} imports ${specifier}`),
      );
    expect(violations).toEqual([]);
  });

  it("gives each cache its own module, named after the cache, outside the router layer", () => {
    const violations = filesIn(cacheDirectory)
      .filter((file) => !factoryModules.has(relative(cacheDirectory, file)))
      .flatMap((file) => {
        const name = relative(sourceRoot, file);
        const calls = factoryCalls(file);
        const stem = relative(cacheDirectory, file).replace(/\.ts$/, "");
        return [
          ...(calls.length === 1 ? [] : [`${name} builds ${calls.length} caches`]),
          ...calls
            .filter((cacheName) => camelCase(cacheName) !== stem)
            .map((cacheName) => `${name} builds "${cacheName}"`),
          ...imports(file)
            .filter((specifier) => specifier.startsWith("@/server/api/"))
            .map((specifier) => `${name} imports ${specifier}`),
        ];
      });
    expect(violations).toEqual([]);
  });
});

/** Enumerate TypeScript sources recursively. */
const filesIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesIn(path)
      : /\.[cm]?tsx?$/.test(entry.name)
        ? [path]
        : [];
  });

/** Parse a source file as TypeScript, with JSX for `.tsx` files. */
const syntaxOf = (file: string) =>
  parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }).program.body as unknown as SyntaxNode[];

/** Module specifiers of a file's static imports. */
const imports = (file: string) =>
  syntaxOf(file).flatMap((node) =>
    node.type === "ImportDeclaration"
      ? [String((node.source as SyntaxNode & { value: string }).value)]
      : [],
  );

/** The `name` of every cache factory call in a file. */
const factoryCalls = (file: string) => {
  const calls: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as SyntaxNode;
    if (
      node.type === "CallExpression" &&
      (node.callee as SyntaxNode)?.type === "Identifier" &&
      factories.has(String((node.callee as SyntaxNode).name))
    )
      calls.push(cacheName(node));
    for (const [key, child] of Object.entries(node))
      if (
        ![
          "loc",
          "start",
          "end",
          "comments",
          "leadingComments",
          "trailingComments",
        ].includes(key)
      )
        visit(child);
  };
  visit(syntaxOf(file));
  return calls;
};

/** The string `name` option of a factory call. */
const cacheName = (call: SyntaxNode) => {
  const [options] = call.arguments as SyntaxNode[];
  const property = (options?.properties as SyntaxNode[] | undefined)?.find(
    (entry) => (entry.key as SyntaxNode)?.name === "name",
  );
  const value = property?.value as (SyntaxNode & { value?: unknown }) | undefined;
  return value?.type === "StringLiteral"
    ? String(value.value)
    : "<not a string literal>";
};

/** `open-polls` → `openPolls`. */
const camelCase = (name: string) =>
  name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
