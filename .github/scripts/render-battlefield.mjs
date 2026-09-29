/**
 * Renders battlefield sheets for the content audit with the game's own combat renderer: it
 * opens /manual/review/battlefield on the audited deployment in headless Chrome and saves the
 * PNG sheets that page draws.
 *
 *   MODE=gallery  the most used animation and static assets of an animation-focus snapshot
 *   MODE=verify   current and suggested versions of every suggestion that changes what an
 *                 entity draws in battle, one version per candidate asset
 *
 * Env vars consumed:
 *   BASE_URL, MODE, SNAPSHOT, OUT_DIR, PROPOSALS (verify), VERCEL_BYPASS (previews)
 *
 * Outputs (via GITHUB_OUTPUT):
 *   count        number of sheets written; OUT_DIR/index.json lists the titles on each sheet
 *                and the textures that failed to load
 *   suggestions  JSON array of the proposal indices drawn in verify mode
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { setOutput } from "./ci-helpers.mjs";

const VISUAL_FIELDS = [
  "staticAssetPath",
  "staticAnimation",
  "appearAnimation",
  "disappearAnimation",
];
const GALLERY_SIZE = 32;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const mode = required("MODE");
const outDir = required("OUT_DIR");
const snapshot = JSON.parse(await readFile(required("SNAPSHOT"), "utf8"));
const assetNames = new Map(snapshot.assets.map((asset) => [asset.id, asset.name]));

/** One block for each of the most used animation and static assets. */
const galleryRequests = () =>
  snapshot.assets
    .filter((asset) => asset.type === "ANIMATION" || asset.type === "STATIC")
    .sort((a, b) => b.usedBy - a.usedBy)
    .slice(0, GALLERY_SIZE)
    .map((asset) => ({
      title: `${asset.name} · ${asset.id} · ${asset.type.toLowerCase()}, used by ${asset.usedBy} effects`,
      entityType: "GAME_ASSET",
      entityId: asset.id,
      variants: [
        {
          name:
            asset.type === "STATIC"
              ? "static asset on the middle tile"
              : "looping on the middle tile and playing once on the target",
          fields: { type: asset.type },
        },
      ],
    }));

const lastSegment = (fieldPath) => fieldPath.split(".").pop() ?? "";

/** Whether a value, such as a whole effect list, names an asset combat draws. */
const holdsVisuals = (value) =>
  Array.isArray(value)
    ? value.some(holdsVisuals)
    : value !== null &&
      typeof value === "object" &&
      Object.entries(value).some(
        ([key, entry]) =>
          (VISUAL_FIELDS.includes(key) && typeof entry === "string" && entry !== "") ||
          holdsVisuals(entry),
      );

/** An assignment that changes what the entity draws in battle. */
const setsVisuals = ([fieldPath, value]) =>
  VISUAL_FIELDS.includes(lastSegment(fieldPath)) ||
  fieldPath === "avatar" ||
  holdsVisuals(value);

const isSafePath = (fieldPath) =>
  !fieldPath.split(".").some((segment) => FORBIDDEN_SEGMENTS.has(segment));

/**
 * A change's set operations as [path, value] pairs, or null when a value does not parse or a
 * path is unsafe. The server refuses such a suggestion, so it is not drawn either.
 */
const assignmentsOf = (change) => {
  if (!change.set.every((op) => isSafePath(op.path))) return null;
  try {
    return change.set.map((op) => [op.path, JSON.parse(op.valueJson)]);
  } catch {
    return null;
  }
};

/** Set a dotted path in place, creating the arrays and objects along it. */
const setAtPath = (target, fieldPath, value) => {
  const keys = fieldPath.split(".");
  let node = target;
  for (const [index, key] of keys.slice(0, -1).entries()) {
    if (node[key] === undefined || node[key] === null) {
      node[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
    }
    node = node[key];
  }
  node[keys.at(-1)] = value;
};

/** A copy of `fields` with every [path, value] assignment applied. */
const withValues = (fields, assignments) => {
  const next = structuredClone(fields);
  for (const [fieldPath, value] of assignments) setAtPath(next, fieldPath, value);
  return next;
};

const describe = (id) => `${assetNames.get(id) ?? "asset"} (${id})`;

/** Proposal indices that verify mode draws, so verdicts can only touch those. */
const rendered = new Set();

/** One block per changed entity: its current version, then one version per candidate set. */
const verifyRequests = (output) =>
  output.proposals.flatMap((proposal, index) =>
    proposal.changes.flatMap((change) => {
      const assignments = assignmentsOf(change);
      if (!assignments) return [];
      const media = change.media.filter(
        (request) =>
          request.kind === "ANIMATION" &&
          request.catalogIds.length > 0 &&
          isSafePath(request.path),
      );
      if (!assignments.some(setsVisuals) && media.length === 0) {
        return [];
      }
      const entity = snapshot.entities.find(
        (row) => row.type === change.entityType && row.id === change.entityId,
      );
      if (change.entityId && !entity) return [];
      const current = entity?.fields ?? {};
      const proposed = withValues(current, assignments);
      rendered.add(index);
      const candidates = Math.max(1, ...media.map((request) => request.catalogIds.length));
      const suggested = Array.from({ length: candidates }, (_, k) => {
        const picks = media.map((request) => [
          request.path,
          request.catalogIds[Math.min(k, request.catalogIds.length - 1)],
        ]);
        return {
          name:
            picks.length > 0
              ? `suggested, candidate ${k + 1}: ${picks.map(([p, id]) => `${p} = ${describe(id)}`).join(", ")}`
              : "suggested",
          fields: withValues(proposed, picks),
        };
      });
      return [
        {
          title: `Suggestion ${index}: ${proposal.title} · ${change.entityType} ${entity?.fields?.name ?? change.entityId ?? "(new)"}`,
          entityType: change.entityType,
          entityId: change.entityId,
          // A media request holds at most 3 catalog ids, so current plus candidates stays
          // within the 4 versions the capture page accepts per block.
          variants: [...(entity ? [{ name: "current", fields: current }] : []), ...suggested],
        },
      ];
    }),
  );

const requests =
  mode === "gallery"
    ? galleryRequests()
    : verifyRequests(JSON.parse(await readFile(required("PROPOSALS"), "utf8")));

await mkdir(outDir, { recursive: true });
setOutput("suggestions", JSON.stringify([...rendered]));
if (requests.length === 0) {
  await writeFile(
    path.join(outDir, "index.json"),
    JSON.stringify({ mode, sheets: [] }, null, 2),
  );
  setOutput("count", 0);
  console.log("Nothing to render.");
  process.exit(0);
}

// Headless Chrome has no GPU on CI runners; SwiftShader gives it WebGL.
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[page] ${message.text()}`);
  });
  page.on("pageerror", (error) => console.log(`[page] ${error.message}`));
  // The bypass rides on a cookie: a header would also reach the image hosts and fail CORS.
  const url = new URL("/manual/review/battlefield", required("BASE_URL"));
  if (process.env.VERCEL_BYPASS) {
    url.searchParams.set("x-vercel-protection-bypass", process.env.VERCEL_BYPASS);
    url.searchParams.set("x-vercel-set-bypass-cookie", "true");
  }
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.tnrBattlefield), null, {
    timeout: 120_000,
  });
  const result = await page.evaluate(
    (input) => window.tnrBattlefield.renderSheets(input),
    { requests, perSheet: mode === "gallery" ? 2 : 1, background: "ground" },
  );
  const sheets = [];
  for (const [index, sheet] of result.sheets.entries()) {
    const file = `${mode}-${String(index + 1).padStart(2, "0")}.png`;
    await writeFile(
      path.join(outDir, file),
      Buffer.from(sheet.png.slice(sheet.png.indexOf(",") + 1), "base64"),
    );
    sheets.push({ file, titles: sheet.titles });
  }
  await writeFile(
    path.join(outDir, "index.json"),
    JSON.stringify({ mode, sheets, texturesThatFailed: result.missing }, null, 2),
  );
  setOutput("count", sheets.length);
  console.log(`Rendered ${requests.length} blocks onto ${sheets.length} sheets.`);
  if (result.missing.length > 0) {
    console.log(`Textures that failed to load: ${result.missing.join(", ")}`);
  }
} finally {
  await browser.close();
}
