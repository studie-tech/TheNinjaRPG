import { afterAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

/**
 * A loading boundary streams its fallback before the segments beneath it render, so a
 * status-setting call below it can no longer set the response status: notFound() answers
 * 200 with a not-found body (a soft 404 for crawlers), and redirect() or an auth interrupt
 * becomes a client-side redirect on a 200. Boundaries therefore sit only in route folders
 * whose subtree, and every app module it reaches through imports, never uses one of those
 * functions, and never at the shell level. A module counts when it imports from
 * next/navigation and names one of them, so aliased imports and generic calls are caught
 * at the cost of the occasional false positive.
 */
const APP_ROOT = join(import.meta.dirname, "../../src/app");
const SHELL_ROOT = join(APP_ROOT, "[shell]");
const NAVIGATION_IMPORT = /from\s*["']next\/navigation["']/;
const STATUS_NAME =
  /\b(?:notFound|redirect|permanentRedirect|forbidden|unauthorized)\b/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;

// Typed locally: importing "bun" would load its global types into the whole program.
const { Transpiler, resolveSync } = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const transpiler = new Transpiler();

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

/** App modules (`@/` or relative) a file imports, resolved to their files. */
const appImports = (file: string) =>
  transpiler
    .scanImports(readFileSync(file, "utf8"), /\.[cm]?ts$/.test(file) ? "ts" : "tsx")
    .map((entry) => entry.path)
    .filter((specifier) => specifier.startsWith("@/") || specifier.startsWith("."))
    .flatMap((specifier) => {
      try {
        return [resolveSync(specifier, dirname(file))];
      } catch {
        return [];
      }
    })
    .filter(
      (resolved) => CODE_FILE.test(resolved) && !resolved.includes("/node_modules/"),
    );

/** Every app module a route file reaches through imports, the file itself excluded. */
const reachableAppModules = (file: string) => {
  const visited = new Set([file]);
  const queue = [file];
  for (let at = queue.shift(); at; at = queue.shift()) {
    for (const imported of appImports(at)) {
      if (visited.has(imported)) continue;
      visited.add(imported);
      queue.push(imported);
    }
  }
  visited.delete(file);
  return [...visited];
};

const usesStatusFunction = (file: string) => {
  const code = readFileSync(file, "utf8");
  return NAVIGATION_IMPORT.test(code) && STATUS_NAME.test(code);
};

/** Each route file under a loading boundary that can set a status, with the module making the call. */
const findBoundaryOffenders = (root: string) => {
  const files = walk(root);
  return files
    .filter((file) => file.endsWith("/loading.tsx"))
    .map((file) => dirname(file))
    .flatMap((dir) => {
      if (dir === root || dir === join(root, "[shell]")) {
        return [relative(root, join(dir, "loading.tsx"))];
      }
      return files
        .filter((file) => file.startsWith(`${dir}/`) && CODE_FILE.test(file))
        .flatMap((file) => {
          const route = relative(root, file);
          if (file.endsWith("/not-found.tsx")) return [route];
          if (usesStatusFunction(file)) return [route];
          return reachableAppModules(file)
            .filter(usesStatusFunction)
            .map((imported) => `${route} -> ${relative(root, imported)}`);
        });
    });
};

const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), "route-loading-")));
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

const writeFixture = (files: Record<string, string>) => {
  const root = mkdtempSync(join(fixtureRoot, "case-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
};

const LOADING = "export default function Loading() { return null; }\n";

describe("route loading boundaries", () => {
  it("never wrap a route that can set a 404 or redirect status", () => {
    expect(findBoundaryOffenders(APP_ROOT)).toEqual([]);
  });

  it("rejects loading boundaries at the app and shell roots", () => {
    const root = writeFixture({
      "loading.tsx": LOADING,
      "[shell]/loading.tsx": LOADING,
    });
    expect(findBoundaryOffenders(root).sort()).toEqual([
      "[shell]/loading.tsx",
      "loading.tsx",
    ]);
  });

  it("give the server-rendered board and guide pages an instant shell", () => {
    const loadingDirs = walk(SHELL_ROOT)
      .filter((file) => file.endsWith("/loading.tsx"))
      .map((file) => relative(SHELL_ROOT, dirname(file)));
    expect(loadingDirs).toEqual(
      expect.arrayContaining([
        "globalanbuhq",
        "guide/(hub)",
        "historybuilding",
        "news",
      ]),
    );
  });

  it("catches status functions in nested routes, aliased imports and imported modules", () => {
    const root = writeFixture({
      "board/loading.tsx": LOADING,
      "board/page.tsx": `import { useRouter } from "next/navigation";\nexport default function Page() { useRouter(); return null; }\n`,
      "board/alias/page.tsx": `import { notFound as nf } from "next/navigation";\nexport default function Page() { nf(); }\n`,
      "board/deep/page.tsx": `import { check } from "../../lib/index";\nexport default function Page() { check(); return null; }\n`,
      "lib/index.ts": `export { check } from "./inner";\n`,
      "lib/inner.ts": `import { redirect } from "next/navigation";\nexport const check = () => redirect<string>("/x");\n`,
      "board/[id]/page.tsx": `import { redirect } from "next/navigation";\nexport default function Page() { redirect("/x"); }\n`,
      "board/old/page.tsx": `import { guard } from "./guard";\nexport default function Page() { guard(); return null; }\n`,
      "board/old/guard.ts": `import { forbidden } from "next/navigation";\nexport const guard = () => forbidden();\n`,
      "board/gone/not-found.tsx":
        "export default function NotFound() { return null; }\n",
      "other/page.tsx": `import { notFound } from "next/navigation";\nexport default function Page() { notFound(); }\n`,
    });
    expect(findBoundaryOffenders(root).sort()).toEqual([
      "board/[id]/page.tsx",
      "board/alias/page.tsx",
      "board/deep/page.tsx -> lib/inner.ts",
      "board/gone/not-found.tsx",
      "board/old/guard.ts",
      "board/old/page.tsx -> board/old/guard.ts",
    ]);
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
