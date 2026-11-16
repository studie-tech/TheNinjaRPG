import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Every procedure is served by the one `/api/trpc` function, so each new instance
 * evaluates everything the route reaches through static imports before it answers its
 * first request. The SDKs listed here take tens to hundreds of milliseconds to evaluate
 * and serve only generation, upload, moderation, payment and social-posting paths, so
 * the code that uses them loads them with `await import()` at the point of use and
 * keeps type-only references as `import type`.
 *
 * Bun's scanner skips `import type` and all-type specifier lists but keeps a plain
 * import whose bindings are only used as types, so mark such an import `import type`.
 */
const APP_ROOT = join(import.meta.dirname, "../../..");
const ENTRY = join(APP_ROOT, "src/app/api/trpc/[trpc]/route.ts");

const DEFERRED_PACKAGES =
  /^(?:openai(?:\/.*)?|ai|@ai-sdk\/.+|stripe(?:\/.*)?|sharp|replicate|uploadthing(?:\/.*)?|text-to-svg|node-html-markdown|jszip)$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;

// Typed locally: importing "bun" would load its global types into the whole program.
const { Transpiler, resolveSync } = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const transpiler = new Transpiler();

const staticImports = (file: string) =>
  transpiler
    .scanImports(readFileSync(file, "utf8"), /\.[cm]?ts$/.test(file) ? "ts" : "tsx")
    .filter(
      (entry) => entry.kind === "import-statement" || entry.kind === "require-call",
    )
    .map((entry) => entry.path);

const resolveFrom = (file: string, specifier: string) => {
  try {
    return resolveSync(specifier, dirname(file));
  } catch {
    return undefined;
  }
};

/** Each deferred package the entry reaches through static imports, as an import chain. */
const findEagerImports = (entry: string) => {
  const cameFrom = new Map<string, string | null>([[entry, null]]);
  const chain = (file: string) => {
    const steps: string[] = [];
    for (let at: string | null | undefined = file; at; at = cameFrom.get(at)) {
      steps.unshift(relative(APP_ROOT, at));
    }
    return steps.join(" > ");
  };

  const offenders: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const specifier of staticImports(file)) {
      if (DEFERRED_PACKAGES.test(specifier)) {
        offenders.push(`${chain(file)} > ${specifier}`);
        continue;
      }
      const target = resolveFrom(file, specifier);
      const local =
        target?.startsWith(APP_ROOT) && !target.includes("/node_modules/")
          ? target
          : undefined;
      if (!local || !CODE_FILE.test(local) || cameFrom.has(local)) continue;
      cameFrom.set(local, file);
      queue.push(local);
    }
  }
  return offenders;
};

describe("tRPC route cold start", () => {
  it("loads rarely used SDKs only when a procedure needs them", () => {
    expect(findEagerImports(ENTRY)).toEqual([]);
  });
});

type BunRuntime = {
  Transpiler: new () => {
    scanImports: (
      code: string,
      loader: "ts" | "tsx",
    ) => { kind: string; path: string }[];
  };
  resolveSync: (specifier: string, from: string) => string;
};
