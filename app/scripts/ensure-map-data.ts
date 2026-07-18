/**
 * Ensure `src/data/hexasphere.json` (the globe topology the server bundles and
 * the tests import) is present, fetching it from its canonical UploadThing
 * source (IMG_MAP_HEXASPHERE) when missing.
 *
 * UploadThing is the single source of truth for the globe topology: the client
 * fetches it from the CDN at runtime, and the server/tests get the same bytes
 * at build time here — so the file is gitignored rather than committed as a
 * second copy that could drift from the CDN one. This runs on `postinstall`,
 * so `bun install` (CI, local, fresh clone) leaves the file in place before any
 * test/typecheck/build; it is a no-op once the file exists.
 *
 * Regenerating the globe (scripts/generate-globe.ts) overwrites this file
 * locally; upload it with scripts/upload-map-asset.ts and repoint the constant.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { IMG_MAP_HEXASPHERE, IMG_MAP_HEXASPHERE_SHA256 } from "@/drizzle/constants";
import { fetchWithRetry } from "@/utils/http";

const OUT = "src/data/hexasphere.json";

// Per-attempt timeout so a stalled connection cannot hang `postinstall`
// forever; the retry deadline bounds the total time across all attempts.
const REQUEST_TIMEOUT_MS = 20_000;
const RETRY = { maxRetries: 3, baseDelayMs: 1000, deadlineMs: 120_000 };

/** Fetch and write the topology if missing (no-op when the file exists) */
const main = async () => {
  if (existsSync(OUT)) return;
  console.log(`Fetching globe topology from ${IMG_MAP_HEXASPHERE}`);
  const response = await fetchWithRetry(
    IMG_MAP_HEXASPHERE,
    { cache: "no-store" },
    REQUEST_TIMEOUT_MS,
    RETRY,
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  // Verify integrity: a compromised CDN/account must not be able to bake
  // arbitrary globe topology (walkability, seam rotations) into the build.
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== IMG_MAP_HEXASPHERE_SHA256) {
    throw new Error(
      `hexasphere.json integrity check failed: expected ${IMG_MAP_HEXASPHERE_SHA256}, got ${digest}. ` +
        "If the globe was regenerated, update IMG_MAP_HEXASPHERE_SHA256 in constants.ts.",
    );
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, buffer);
  console.log(`Wrote ${OUT} (${buffer.byteLength} bytes, sha256 verified)`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // Non-fatal: a transient CDN/network failure must not hard-fail `bun install`
    // (fresh clones, CI, Docker installs, or a `bun add` while the CDN blips).
    // The topology is still required to build/run, so warn loudly with the manual
    // recovery step; the next install retries, and any build/test that imports the
    // file surfaces a clear error if it is genuinely still missing.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `\n[ensure-map-data] WARNING: could not fetch globe topology from ${IMG_MAP_HEXASPHERE}\n` +
        `  ${reason}\n` +
        `  Install will continue, but the app cannot build or run without ${OUT}.\n` +
        `  Re-run once connectivity is restored:  bun run scripts/ensure-map-data.ts\n`,
    );
    process.exit(0);
  });
