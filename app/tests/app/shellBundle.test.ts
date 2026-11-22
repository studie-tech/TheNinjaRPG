import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * The shell layout and everything it imports statically load on every page, signed in or
 * not, so these modules are kept behind dynamic imports that load only where they are
 * used: the frames a variant does not render, the signed-in sidebar and live updates, the
 * HTML parser, the tutorial and combat rules, and, on the server, the tRPC router and the
 * upload router. A static import of one of them from the shell's graph fails here, with
 * the chain that reaches it.
 */
const APP_ROOT = join(import.meta.dirname, "../..");
const SHELL_LAYOUT = join(APP_ROOT, "src/app/[shell]/layout.tsx");
const DEFERRED_FILES = [
  "src/components/layout/ExperimentalGameLayout.tsx",
  "src/components/layout/ExperimentalTravelHost.tsx",
  "src/screens/travel/TravelScreen.tsx",
  "src/components/layout/ClassicGameLayout.tsx",
  "src/components/layout/PanelGameLayout.tsx",
  "src/components/layout/PixelGameLayout.tsx",
  "src/components/layout/PanelPublicLayout.tsx",
  "src/components/layout/PixelPublicLayout.tsx",
  "src/components/layout/GameLayout.tsx",
  "src/layout/MenuBoxProfile.tsx",
  "src/screens/travel/TravelView.tsx",
  "src/screens/bank/BankScreen.tsx",
  "src/screens/itemshop/ItemShopScreen.tsx",
  "src/hooks/useTravelSession.ts",
  "src/layout/ActivityStreakPanel.tsx",
  "src/utils/parse.ts",
  "src/hooks/tutorial.tsx",
  "src/libs/combat/actions.ts",
  "src/server/api/root.ts",
  "src/app/api/uploadthing/core.ts",
];
const DEFERRED_PACKAGES = /^(?:pusher-js|htmlparser2)(?:\/.*)?$/;
const STATIC_IMPORT_KINDS = new Set(["import-statement", "require-call"]);
const CODE_FILE = /\.[cm]?[jt]sx?$/;

// Typed locally: importing "bun" would load its global types into the whole program.
const { Transpiler, resolveSync } = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const transpiler = new Transpiler();

const staticImports = (file: string) =>
  transpiler
    .scanImports(readFileSync(file, "utf8"), /\.[cm]?ts$/.test(file) ? "ts" : "tsx")
    .filter((entry) => STATIC_IMPORT_KINDS.has(entry.kind))
    .map((entry) => entry.path);

const resolveFrom = (file: string, specifier: string) => {
  try {
    return resolveSync(specifier, dirname(file));
  } catch {
    return undefined;
  }
};

/** Each deferred module the entry reaches through static imports, as an import chain. */
const findStaticallyReached = (entry: string) => {
  const deferredFiles = new Set(DEFERRED_FILES.map((path) => join(APP_ROOT, path)));
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
      if (
        !target?.startsWith(APP_ROOT) ||
        target.includes("/node_modules/") ||
        !CODE_FILE.test(target) ||
        cameFrom.has(target)
      )
        continue;
      cameFrom.set(target, file);
      if (deferredFiles.has(target)) {
        offenders.push(chain(target));
        continue;
      }
      queue.push(target);
    }
  }
  return offenders;
};

describe("shell layout bundle", () => {
  it("reaches the deferred modules only through dynamic imports", () => {
    expect(findStaticallyReached(SHELL_LAYOUT)).toEqual([]);
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
