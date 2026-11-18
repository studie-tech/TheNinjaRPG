/**
 * Build Shuriken Siege, the standalone tower defense game, as one zip per portal target.
 *
 * Usage (from app/, or `make shuriken-siege` from the repository root):
 *   bun run scripts/build-shuriken-siege.ts [--targets web,plain,crazygames,poki]
 *     [--source itch] [--version 1.0.0] [--api https://www.theninja-rpg.com]
 *     [--out ../dist/shuriken-siege] [--cache ~/.cache/shuriken-siege]
 *
 * The roster, sounds and character catalog are snapshotted from the live game, and every
 * media file the arena can load is downloaded into the zip, so a portal serves the whole
 * game from its own CDN. See docs/ShurikenSiege.md.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import {
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  IMG_LOADER,
  IMG_LOGO_FULL,
  SHURIKEN_SIEGE_LOGO_URL,
  TD_BLAST_ANIMATION,
  TD_SENTRY_ATLAS,
  TD_SENTRY_EFFECTS,
  TD_SFX,
  TD_SHURIKEN_IMAGE_URL,
  TD_STAGE_IMAGE_URLS,
} from "@/drizzle/constants";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import bakedWorldSources from "@/libs/rendering/bakedWorldSources.json";
import { type LpcCatalog, spriteLayerSheets } from "@/libs/lpc/catalog";
import { prepareTowerDefenseTerrain } from "@/libs/rendering/scenes/towerDefenseTerrain";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";
import {
  SHURIKEN_SIEGE_TARGETS,
  type ShurikenSiegeBuild,
  type ShurikenSiegeData,
  type ShurikenSiegeTarget,
} from "@/standalone/shurikenSiege/build";
import { bundledMediaKey, transformImageUrl } from "@/utils/image";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The script runs on Bun, whose bundler builds the game; the app's types do not know it. */
const bun = (globalThis as unknown as { Bun: BunBundler }).Bun;
const ENTRY = join(APP, "src/standalone/shurikenSiege/main.tsx");
const STYLES = join(APP, "src/standalone/shurikenSiege/styles.css");
const SHIMS = join(APP, "src/standalone/shurikenSiege/shims");
/** Arena terrain is seeded per run; this many seeds cover every look it can roll. */
const TERRAIN_SEEDS = 400;
const TERRAIN_SIZE = 29;

/** Each target's links, and the portal SDK its page loads. */
const TARGETS: Record<ShurikenSiegeTarget, { links: boolean; sdk?: string }> = {
  // itch.io, Newgrounds, Armor Games: links back to TheNinja-RPG are welcome.
  web: { links: true },
  // Portals that forbid outgoing links but need no SDK (Game Jolt, Y8, ...).
  plain: { links: false },
  crazygames: { links: false, sdk: "https://sdk.crazygames.com/crazygames-sdk-v3.js" },
  poki: { links: false, sdk: "https://game-cdn.poki.com/scripts/v2/poki-sdk.js" },
};

const args = parseArgs(process.argv.slice(2));
const targets = (args.targets?.split(",") ?? [...SHURIKEN_SIEGE_TARGETS]).map((target) => {
  if (!(SHURIKEN_SIEGE_TARGETS as readonly string[]).includes(target))
    throw new Error(`Unknown target "${target}"`);
  return target as ShurikenSiegeTarget;
});
const api = (args.api ?? "https://www.theninja-rpg.com").replace(/\/$/, "");
const out = resolve(args.out ?? join(APP, "../dist/shuriken-siege"));
const cache = resolve(args.cache ?? join(homedir(), ".cache/shuriken-siege"));
const version = args.version ?? new Date().toISOString().slice(0, 10);

console.log(`Shuriken Siege ${version}: ${targets.join(", ")} from ${api}`);
mkdirSync(cache, { recursive: true });

// 1. Game data, as the live game serves it
const [roster, assets, lpcCatalog] = await Promise.all([
  trpcQuery<ShurikenSiegeData["roster"]>("towerDefense.getRoster", null),
  trpcQuery<ShurikenSiegeData["assets"]>("misc.getAllGameAssetNames", {
    ids: [ID_ANIMATION_HIT, ID_ANIMATION_SMOKE, ...Object.values(TD_SFX)],
  }),
  trpcQuery<LpcCatalog>("gameAsset.getLpcSceneCatalog", null),
]);
console.log(`Data: ${roster.length} enemies, ${assets.length} assets`);

// 2. Every media file the game can request
const media = new Set<string>();
const addMedia = (url: string | null | undefined) => {
  if (url && /^https?:\/\//.test(url)) media.add(bundledMediaKey(transformImageUrl(url)));
};
for (const url of [
  TD_SHURIKEN_IMAGE_URL,
  TD_SENTRY_ATLAS.url,
  TD_BLAST_ANIMATION.image,
  SHURIKEN_SIEGE_LOGO_URL,
  IMG_LOGO_FULL,
  IMG_LOADER,
  ...Object.values(TD_SENTRY_EFFECTS).map((effect) => effect.image),
  ...Object.values(TD_STAGE_IMAGE_URLS),
])
  addMedia(url);
for (const asset of assets) {
  addMedia(asset.url);
  addMedia(asset.image);
}
for (const enemy of roster) {
  addMedia(enemy.avatar);
  for (const animation of Object.values(enemy.animations ?? {})) {
    if (!animation) continue;
    // The arena draws enemies from the small sheets; older art has only the full one.
    addMedia(animation.smallUrl ?? animation.url);
  }
}
const appearance = resolveSpriteAppearance({ gender: "Male" });
for (const layer of appearance.layers)
  for (const sheet of spriteLayerSheets(lpcCatalog, appearance, layer, "all"))
    addMedia(sheet.image);
const worldPaths = new Set<string>();
for (let seed = 0; seed < TERRAIN_SEEDS; seed++)
  collectStrings(prepareTowerDefenseTerrain(`shuriken-siege-${seed}`, TERRAIN_SIZE), (value) => {
    if (value.startsWith("/world-art/")) worldPaths.add(value);
    else addMedia(value);
  });
for (const path of worldPaths) collectStrings(worldAssetSource(path), addMedia);
// Scenery casts baked shadows from atlases keyed by the artwork they belong to.
const scenery = [...media];
for (const [key, source] of Object.entries(bakedWorldSources))
  if (scenery.some((url) => key.includes(url) || key.includes(rawUploadUrl(url)))) {
    collectStrings(JSON.parse(key), addMedia);
    collectStrings(source, addMedia);
  }
console.log(`Media: ${media.size} files`);

// 3. Download them once into the cache, named by content so portals serve the right type
const indexPath = join(cache, "index.json");
const index: Record<string, string> = existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, "utf8"))
  : {};
const files = new Map<string, string>();
await pool([...media], 12, async (url) => {
  const known = index[url];
  if (known && existsSync(join(cache, known))) {
    files.set(url, known);
    return;
  }
  const response = await fetch(url, { headers: { "user-agent": "shuriken-siege-build" } });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  const name = `${createHash("sha1").update(url).digest("hex").slice(0, 16)}${mediaExtension(url, response.headers.get("content-type"))}`;
  writeFileSync(join(cache, name), Buffer.from(await response.arrayBuffer()));
  index[url] = name;
  files.set(url, name);
});
writeFileSync(indexPath, JSON.stringify(index, null, 1));

// 4. The game's code and styles, shared by every target
const work = join(cache, "build");
rmSync(work, { recursive: true, force: true });
const bundle = await bun.build({
  entrypoints: [ENTRY],
  outdir: work,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  naming: { entry: "[name].[ext]", chunk: "chunks/[name]-[hash].[ext]" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  banner: "var process = globalThis.process || { env: {} };",
  plugins: [
    {
      name: "shuriken-siege-shims",
      setup(builder: BunPluginBuilder) {
        const shims: Record<string, string> = {
          "@/layout/Link": "Link.tsx",
          "@/layout/Image": "Image.tsx",
          "@/libs/toast": "toast.tsx",
          "@/hooks/lpc": "lpc.ts",
          "@sentry/nextjs": "sentry.ts",
        };
        builder.onResolve(
          { filter: /^(@\/layout\/(Link|Image)|@\/libs\/toast|@\/hooks\/lpc|@sentry\/nextjs)$/ },
          (resolved: { path: string }) => ({ path: join(SHIMS, shims[resolved.path] ?? "") }),
        );
        // Anything Next.js-specific left in the game's imports is a mistake to surface.
        builder.onResolve({ filter: /^next(\/|$)/ }, (resolved: { path: string; importer: string }) => {
          throw new Error(`${resolved.importer} imports ${resolved.path}`);
        });
      },
    },
  ],
});
if (!bundle.success) {
  for (const log of bundle.logs) console.error(log);
  throw new Error("Bundling failed");
}
const css = await postcss([tailwind({ base: dirname(STYLES) })]).process(
  readFileSync(STYLES, "utf8"),
  { from: STYLES },
);
writeFileSync(join(work, "app.css"), css.css);

// 5. One folder and zip per target
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const target of targets) {
  const dir = join(out, target);
  mkdirSync(join(dir, "assets"), { recursive: true });
  cpSync(work, dir, { recursive: true });
  const mediaMap: Record<string, string> = {};
  for (const [url, name] of files) {
    copyFileSync(join(cache, name), join(dir, "assets", name));
    mediaMap[url] = `assets/${name}`;
  }
  const data: ShurikenSiegeData = { roster, assets, lpcCatalog, media: mediaMap };
  writeFileSync(join(dir, "data.json"), JSON.stringify(data));
  const build: ShurikenSiegeBuild = {
    target,
    links: TARGETS[target].links,
    source: args.source ?? target,
    version,
  };
  writeFileSync(join(dir, "index.html"), page(build, TARGETS[target].sdk));
  const zip = join(out, `shuriken-siege-${target}-${version}.zip`);
  execFileSync("zip", ["-qr", zip, "."], { cwd: dir });
  const count = execFileSync("find", [".", "-type", "f"], { cwd: dir, encoding: "utf8" })
    .trim()
    .split("\n").length;
  const kilobytes = Number(
    execFileSync("du", ["-sk", dir], { encoding: "utf8" }).split("\t")[0],
  );
  console.log(
    `${target}: ${relative(process.cwd(), zip)} · ${count} files · ${(kilobytes / 1000).toFixed(1)} MB`,
  );
}

/** The bundler of the Bun runtime this script runs on, typed to what the build uses. */
interface BunPluginBuilder {
  onResolve: (
    options: { filter: RegExp },
    resolve: (args: { path: string; importer: string }) => { path: string },
  ) => void;
}
interface BunBundler {
  build: (options: Record<string, unknown>) => Promise<{ success: boolean; logs: unknown[] }>;
}

/** The page: viewport, title, build config, the portal SDK if any, styles and code. */
function page(build: ShurikenSiegeBuild, sdk?: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Shuriken Siege</title>
<meta name="description" content="Defend the ninja village against endless raiders with shuriken, hand seals and sentries. A game by TheNinja-RPG.">
<link rel="stylesheet" href="app.css">
<script>window.__SHURIKEN_SIEGE__=${JSON.stringify(build)};</script>
${sdk ? `<script src="${sdk}"></script>\n` : ""}</head>
<body>
<div id="root"></div>
<script type="module" src="main.js"></script>
</body>
</html>
`;
}

/** Query a public tRPC procedure of the live game. */
async function trpcQuery<T>(path: string, input: unknown): Promise<T> {
  const url = `${api}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await fetch(url, { headers: { "user-agent": "shuriken-siege-build" } });
  if (!response.ok) throw new Error(`${response.status} from ${path}`);
  const body = (await response.json()) as { result?: { data?: { json?: T } } };
  if (body.result?.data?.json === undefined) throw new Error(`No data from ${path}`);
  return body.result.data.json;
}

/** A Bunny URL as its UploadThing original, the host baked sources may still name. */
function rawUploadUrl(url: string) {
  return url.replace("https://uploadthing.b-cdn.net/", "https://ui0arpl8sm.ufs.sh/");
}

/** Every string inside a value, at any depth. */
function collectStrings(value: unknown, visit: (value: string) => void, seen = new Set()) {
  if (typeof value === "string") visit(value);
  else if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) collectStrings(child, visit, seen);
  }
}

/** A file extension for a media file; extensionless uploads are named by their type. */
function mediaExtension(url: string, type: string | null) {
  const ext = extname(new URL(url).pathname).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|svg|mp3|ogg|wav|json)$/.test(ext)) return ext;
  const byType: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "application/json": ".json",
  };
  return byType[type?.split(";")[0]?.trim() ?? ""] ?? ".bin";
}

async function pool<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await task(items[next++] as T);
    }),
  );
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) parsed[key] = argv[++i] ?? "";
  }
  return parsed as Partial<
    Record<"targets" | "source" | "version" | "api" | "out" | "cache", string>
  >;
}
