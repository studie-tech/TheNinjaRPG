/**
 * Build Shuriken Siege, the standalone tower defense game, as one zip per portal target.
 *
 * Usage (from app/, or `make shuriken-siege` from the repository root):
 *   bun run scripts/build-shuriken-siege.ts [--targets web,plain,poki]
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
  mkdtempSync,
  readFileSync,
  renameSync,
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
  IMG_LOGO_SHORT,
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
  // itch.io, Newgrounds: links back to TheNinja-RPG are welcome.
  web: { links: true },
  // Portals that forbid outgoing links but need no SDK (Game Jolt, Y8, ...).
  plain: { links: false },
  poki: { links: false, sdk: "https://game-cdn.poki.com/scripts/v2/poki-sdk.js" },
  gamedistribution: {
    links: false,
    sdk: "https://html5.api.gamedistribution.com/main.min.js",
  },
  // GamePix syncs localStorage only for a page that loaded its SDK before any game code.
  gamepix: { links: false, sdk: "https://integration.gamepix.com/sdk/v3/gamepix.sdk.js" },
  // Playables must load their SDK before any game code.
  youtube: { links: false, sdk: "https://www.youtube.com/game_api/v1" },
};

const args = parseArgs(process.argv.slice(2));
/** GameDistribution's id for the game, from its developer portal; required for its build. */
const gdGameId = args["gd-game-id"] ?? "";
if (gdGameId && !/^[0-9a-z]{16,64}$/i.test(gdGameId))
  throw new Error("--gd-game-id must be the game ID from GameDistribution's developer portal");
const targets = (
  args.targets?.split(",") ??
  // Without its game ID the GameDistribution build is left out of a full build.
  SHURIKEN_SIEGE_TARGETS.filter((target) => target !== "gamedistribution" || gdGameId)
).map((target) => {
  if (!(SHURIKEN_SIEGE_TARGETS as readonly string[]).includes(target))
    throw new Error(`Unknown target "${target}"`);
  if (target === "gamedistribution" && !gdGameId)
    throw new Error("The gamedistribution target needs --gd-game-id (GD_GAME_ID with make)");
  return target as ShurikenSiegeTarget;
});
if (!gdGameId && !args.targets)
  console.log("Skipping gamedistribution: pass GD_GAME_ID to build it");
const api = (args.api ?? "https://www.theninja-rpg.com").replace(/\/$/, "");
for (const option of ["out", "cache", "source", "version", "api", "targets"] as const)
  if (args[option] === "") throw new Error(`--${option} needs a value`);
const out = resolve(args.out ?? join(APP, "../dist/shuriken-siege"));
const cache = resolve(args.cache ?? join(homedir(), ".cache/shuriken-siege"));
const version = args.version ?? new Date().toISOString().slice(0, 10);
// Version and source name the output folder and zip (`<target>_<source>-<version>`), so
// they stay plain names that cannot reach another path, and each name parses one way only:
// the source has neither "_" nor "-", the version no "_", and no version ends in ".zip".
if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(version) || /\.zip$/i.test(version))
  throw new Error('--version must be letters, digits, "." or "-", not ending in .zip');
if (args.source !== undefined && !/^[0-9A-Za-z]+$/.test(args.source))
  throw new Error("--source must be letters and digits");

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
  IMG_LOGO_SHORT,
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

// 4. The game's code and styles, shared by every target, staged apart from other builds
const work = mkdtempSync(join(cache, "build-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
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

// 5. One folder and zip per target, named by its source and version; only those of this
// build are replaced, so other targets and variants already in `out` stay.
mkdirSync(out, { recursive: true });
for (const target of targets) {
  const source = args.source ?? target;
  const name = `shuriken-siege-${target}${source === target ? "" : `_${source}`}-${version}`;
  // The target is assembled in a staging directory of its own inside `out`, and replaces
  // its previous output only once its folder and zip are complete.
  const finalDir = join(out, name);
  const zip = join(out, `${name}.zip`);
  const staging = mkdtempSync(join(out, ".staging-"));
  process.on("exit", () => rmSync(staging, { recursive: true, force: true }));
  const dir = join(staging, name);
  const partialZip = join(staging, `${name}.zip`);
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
    source,
    version,
  };
  writeFileSync(join(dir, "index.html"), page(build, TARGETS[target].sdk));
  checkPlayablesNames(target, dir);
  execFileSync("zip", ["-qr", partialZip, "."], { cwd: dir });
  rmSync(finalDir, { recursive: true, force: true });
  rmSync(zip, { force: true });
  renameSync(dir, finalDir);
  renameSync(partialZip, zip);
  rmSync(staging, { recursive: true, force: true });
  const count = execFileSync("find", [".", "-type", "f"], { cwd: finalDir, encoding: "utf8" })
    .trim()
    .split("\n").length;
  const kilobytes = Number(
    execFileSync("du", ["-sk", finalDir], { encoding: "utf8" }).split("\t")[0],
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
  // GameDistribution reads its options before its script loads and reports events through
  // them; the page relays each to the game as a window event. Portal SDKs load without
  // holding up the page, so a stalled SDK request leaves the game playable without it;
  // YouTube and GamePix require their SDK before any game code. GamePix is told the game
  // reports its own loading and start.
  const gameDistribution =
    build.target === "gamedistribution"
      ? `<script>window.GD_OPTIONS={gameId:${JSON.stringify(gdGameId)},onEvent:function(event){window.dispatchEvent(new CustomEvent("shuriken-siege:gd",{detail:event.name}));}};</script>
<script id="gamedistribution-jssdk" async src="${sdk}"></script>
`
      : "";
  const first =
    build.target === "youtube"
      ? `<script src="${sdk}"></script>\n`
      : build.target === "gamepix"
        ? `<script>window.GamePixConfig={lifecycle:"manual"};</script>\n<script src="${sdk}"></script>\n`
        : "";
  const other =
    sdk && !gameDistribution && !first ? `<script async src="${sdk}"></script>\n` : "";
  return `<!doctype html>
<html lang="en">
<head>
${first}<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Shuriken Siege</title>
<meta name="description" content="Defend the ninja village against endless raiders with shuriken, hand seals and sentries. A game by TheNinja-RPG.">
<link rel="stylesheet" href="app.css">
<script>window.__SHURIKEN_SIEGE__=${JSON.stringify(build)};</script>
${gameDistribution}${other}</head>
<body>
<div id="root"><div style="display:flex;height:100dvh;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;font:600 18px system-ui,sans-serif;letter-spacing:.05em">Loading Shuriken Siege…</div></div>
<script type="module" src="main.js"></script>
</body>
</html>
`;
}

/** Playables accept only letters, digits, `_`, `-` and `.` in file names. */
function checkPlayablesNames(target: ShurikenSiegeTarget, dir: string) {
  if (target !== "youtube") return;
  const files = execFileSync("find", [".", "-type", "f"], { cwd: dir, encoding: "utf8" })
    .trim()
    .split("\n");
  const invalid = files.filter((file) =>
    file
      .replace(/^\.\//, "")
      .split("/")
      .some((part) => !/^[A-Za-z0-9_.-]+$/.test(part)),
  );
  if (invalid.length) throw new Error(`Playables file names: ${invalid.join(", ")}`);
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
    if (!key) continue;
    // An option followed by another option, or by nothing, has no value; the build
    // rejects it rather than taking the next option's name.
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) parsed[key] = "";
    else {
      parsed[key] = value;
      i++;
    }
  }
  return parsed as Partial<
    Record<"targets" | "source" | "version" | "api" | "out" | "cache" | "gd-game-id", string>
  >;
}
