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
 * whose subtree, and the app modules it imports directly, never make such a call, and
 * never at the shell level.
 */
const SHELL_ROOT = join(import.meta.dirname, "../../src/app/[shell]");
const STATUS_CALL =
  /\b(?:notFound|redirect|permanentRedirect|forbidden|unauthorized)\(/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;

// Typed locally: importing "bun" would load its global types into the whole program.
const { Transpiler, resolveSync } = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const transpiler = new Transpiler();

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

/** App modules (`@/` or relative) a route file imports, resolved to their files. */
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
    .filter((resolved) => CODE_FILE.test(resolved));

const makesStatusCall = (file: string) => STATUS_CALL.test(readFileSync(file, "utf8"));

/** Each route file under a loading boundary that can set a status, with the module making the call. */
const findBoundaryOffenders = (root: string) => {
  const files = walk(root);
  return files
    .filter((file) => file.endsWith("/loading.tsx"))
    .map((file) => dirname(file))
    .flatMap((dir) =>
      files
        .filter((file) => file.startsWith(`${dir}/`) && CODE_FILE.test(file))
        .flatMap((file) => {
          const route = relative(root, file);
          if (file.endsWith("/not-found.tsx")) return [route];
          if (makesStatusCall(file)) return [route];
          return appImports(file)
            .filter(makesStatusCall)
            .map((imported) => `${route} -> ${relative(root, imported)}`);
        }),
    );
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
    expect(findBoundaryOffenders(SHELL_ROOT)).toEqual([]);
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

  it("catches status calls in nested routes and in directly imported modules", () => {
    const root = writeFixture({
      "board/loading.tsx": LOADING,
      "board/page.tsx": "export default function Page() { return null; }\n",
      "board/[id]/page.tsx": `import { redirect } from "next/navigation";\nexport default function Page() { redirect("/x"); }\n`,
      "board/old/page.tsx": `import { guard } from "./guard";\nexport default function Page() { guard(); return null; }\n`,
      "board/old/guard.ts": `import { forbidden } from "next/navigation";\nexport const guard = () => forbidden();\n`,
      "board/gone/not-found.tsx":
        "export default function NotFound() { return null; }\n",
      "other/page.tsx": `import { notFound } from "next/navigation";\nexport default function Page() { notFound(); }\n`,
    });
    expect(findBoundaryOffenders(root).sort()).toEqual([
      "board/[id]/page.tsx",
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
