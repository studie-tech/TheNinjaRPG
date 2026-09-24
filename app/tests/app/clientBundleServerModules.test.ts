import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Everything a "use client" module imports ships to the browser and runs there, so a
 * value import that reaches the drizzle schema, drizzle itself or the database client
 * puts the whole schema, the query builder and the PlanetScale driver into the bundle
 * and evaluates them on page load. Shared libs keep their database code in
 * src/server/utils (see libs/war.ts and server/utils/war.ts) so that client code can
 * import the pure half. react-dom/server is listed too: it is CommonJS, so one import
 * ships both of its renderers whole.
 *
 * `import "server-only"` cannot guard this: the test preload imports the server
 * modules, and that package throws outside a React server environment.
 *
 * Bun's scanner skips `import type` and all-type specifier lists but keeps a plain
 * import whose bindings are only used as types, which the bundler would drop, so it
 * can report more than ships and never less. Mark such an import `import type`.
 */
const APP_ROOT = join(import.meta.dirname, "../..");
const SOURCE_ROOT = join(APP_ROOT, "src");

const SERVER_ONLY_FILES = ["drizzle/schema.ts", "src/server/db.ts", "src/env/server.mjs"];
const SERVER_ONLY_PACKAGES =
  /^(?:drizzle-orm(?:\/.*)?|drizzle-zod|@planetscale\/database|react-dom\/server(?:\..*)?)$/;
const RUNTIME_IMPORT_KINDS = new Set(["import-statement", "dynamic-import", "require-call"]);
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** Next bundles this for every page without a "use client" directive. */
const DIRECTIVELESS_CLIENT_ENTRIES = ["instrumentation-client.ts"];

/**
 * Staff-only content-management forms validated with drizzle-zod insert schemas, which
 * are derived from the table definitions: they may ship the schema and drizzle, but not
 * the database client or the server env.
 */
const SCHEMA_EDITORS = [
  "src/app/[shell]/manual/ai/edit/[aiid]/page.tsx",
  "src/app/[shell]/manual/towerDefense/characters/edit/[characterid]/page.tsx",
];
const SCHEMA_SUPPORT = /^(?:drizzle\/schema\.ts|drizzle-orm(?:\/.*)?|drizzle-zod)$/;

// Typed locally: importing "bun" would load its global types into the whole program.
const { Transpiler, resolveSync } = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const transpiler = new Transpiler();

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return CODE_FILE.test(entry.name) ? [path] : [];
  });

const isClientModule = (file: string) =>
  /^(?:\s|\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)*["']use client["']/.test(readFileSync(file, "utf8"));

const runtimeImports = (file: string) =>
  transpiler
    .scanImports(readFileSync(file, "utf8"), /\.[cm]?ts$/.test(file) ? "ts" : "tsx")
    .filter((entry) => RUNTIME_IMPORT_KINDS.has(entry.kind))
    .map((entry) => entry.path);

const resolveFrom = (file: string, specifier: string) => {
  try {
    return resolveSync(specifier, dirname(file));
  } catch {
    return undefined;
  }
};

/** Each server-only import reachable from `entries` and not `allowed`, as an import chain. */
const findServerOnlyImports = (entries: string[], allowed?: RegExp) => {
  const cameFrom = new Map<string, string | null>(entries.map((entry) => [entry, null]));
  const chain = (file: string) => {
    const steps: string[] = [];
    for (let at: string | null | undefined = file; at; at = cameFrom.get(at)) {
      steps.unshift(relative(APP_ROOT, at));
    }
    return steps.join(" > ");
  };

  const offenders: string[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const specifier of runtimeImports(file)) {
      const target = resolveFrom(file, specifier);
      const local = target?.startsWith(APP_ROOT) && !target.includes("/node_modules/") ? target : undefined;
      const serverOnly = SERVER_ONLY_PACKAGES.test(specifier)
        ? specifier
        : SERVER_ONLY_FILES.find((path) => local === join(APP_ROOT, path));
      if (serverOnly && !allowed?.test(serverOnly)) {
        offenders.push(`${chain(file)} > ${serverOnly}`);
        continue;
      }
      if (!local || !CODE_FILE.test(local) || cameFrom.has(local)) continue;
      cameFrom.set(local, file);
      queue.push(local);
    }
  }
  return offenders;
};

describe("client bundle", () => {
  it("never reaches server-only files or packages", () => {
    const entries = [
      ...sourceFiles(SOURCE_ROOT).filter(isClientModule),
      ...DIRECTIVELESS_CLIENT_ENTRIES.map((path) => join(APP_ROOT, path)),
    ];
    const editors = SCHEMA_EDITORS.map((path) => join(APP_ROOT, path));

    expect(entries.length).toBeGreaterThan(100);
    for (const editor of editors) expect(entries).toContain(editor);
    expect(findServerOnlyImports(entries.filter((entry) => !editors.includes(entry)))).toEqual([]);
    expect(findServerOnlyImports(editors, SCHEMA_SUPPORT)).toEqual([]);
  });
});

type BunRuntime = {
  Transpiler: new () => {
    scanImports: (code: string, loader: "ts" | "tsx") => { kind: string; path: string }[];
  };
  resolveSync: (specifier: string, from: string) => string;
};
