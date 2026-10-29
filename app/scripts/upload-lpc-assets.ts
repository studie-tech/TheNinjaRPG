/**
 * Publish staged LPC artwork to UploadThing, preserving every RGBA pixel.
 * Run after import-lpc-assets.py: make bun run scripts/upload-lpc-assets.ts
 * Checkpoints stay beside staged artwork; only the published catalogue is committed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import type { LpcLayout, LpcSheet } from "../src/libs/lpc/catalog";
import { servedUfsUrl } from "../src/libs/uploadthing";
import { fetchWithRetry } from "../src/utils/http";
import { textureImageUrl } from "../src/utils/image";
import { withRetry } from "../src/utils/retry";

/** Content-addressed uploads can be resumed without replacing existing files. */
const main = async () => {
  const directory = resolve(process.argv[2] ?? "scripts/.artifacts/lpc");
  const catalog = JSON.parse(await readFile(`${directory}/catalog.json`, "utf8")) as {
    entries: Record<string, LpcSheet[]>;
    layouts: LpcLayout[];
    creditsUrl?: string;
  };
  const sheets = Object.values(catalog.entries).flatMap((layers) =>
    layers.flatMap((sheet) => [sheet, ...(sheet.travel ? [sheet.travel] : [])]),
  );
  const names = [...new Set(sheets.map((sheet) => basename(sheet.image)))].sort();
  const checkpoint = `${directory}/uploads.json`;
  const uploads: Record<string, string> = await readFile(checkpoint, "utf8")
    .then((json) => JSON.parse(json))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return {};
    });
  const urls = new Map<string, string>();
  const bounds = new Map<string, { width: number; height: number }>();
  const utapi = new UTApi();
  let originalBytes = 0;
  let compressedBytes = 0;
  await mkdir(`${directory}/optimized`, { recursive: true });
  for (let offset = 0; offset < names.length; offset += 10) {
    const batch = await Promise.all(
      names.slice(offset, offset + 10).map(async (name) => {
        const source = await readFile(`${directory}/${name}`);
        if (
          `${createHash("sha256").update(source).digest("hex").slice(0, 24)}.png` !==
          name
        ) {
          throw new Error(`Staged atlas hash mismatch: ${name}`);
        }
        const webp = await sharp(source)
          .webp({ lossless: true, exact: true, effort: 6 })
          .toBuffer();
        const bytes = webp.length < source.length ? webp : source;
        const extension = bytes === webp ? "webp" : "png";
        const original = await sharp(source).ensureAlpha().raw().toBuffer();
        const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
        if (!original.equals(decoded)) throw new Error(`Pixel mismatch: ${name}`);
        const metadata = await sharp(bytes).metadata();
        if (
          !metadata.hasAlpha ||
          !metadata.width ||
          !metadata.height ||
          metadata.width > 2048 ||
          metadata.height > 2048
        ) {
          throw new Error(`Invalid atlas bounds or transparency: ${name}`);
        }
        bounds.set(name, { width: metadata.width, height: metadata.height });
        const id = `lpc-${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${extension}`;
        originalBytes += source.length;
        compressedBytes += bytes.length;
        await writeFile(`${directory}/optimized/${id}`, bytes);
        return { name, id, bytes, type: `image/${extension}` };
      }),
    );
    await withRetry(
      async () => {
        const pending = batch.filter((file) => !uploads[file.id]);
        if (!pending.length) return;
        const results = await utapi.uploadFiles(
          pending.map(
            (file) =>
              new UTFile([file.bytes], file.id, {
                type: file.type,
                customId: file.id,
              }),
          ),
          { concurrency: 5 },
        );
        for (const [index, result] of results.entries()) {
          // Raw keys bypass Bunny's automatic resizing/recompression of extension-bearing aliases.
          if (result.data) uploads[pending[index]!.id] = result.data.ufsUrl;
        }
        await writeFile(checkpoint, `${JSON.stringify(uploads, null, 2)}\n`);
        const failed = results.find((result) => result.error);
        if (failed?.error) throw new Error(`Upload failed: ${failed.error.message}`);
      },
      { isTransient: () => true, deadlineMs: 120_000 },
    );
    // Validate the exact delivery URL, including resumed uploads, before publishing it.
    await Promise.all(
      batch.map(async (file) => {
        const url = uploads[file.id]!;
        const response = await fetchWithRetry(textureImageUrl(url, 0), {}, 30_000, {
          deadlineMs: 100_000,
        });
        if (
          !response.ok ||
          !Buffer.from(await response.arrayBuffer()).equals(file.bytes)
        ) {
          throw new Error(`Upload differs from the verified atlas: ${file.id}`);
        }
        urls.set(file.name, url);
      }),
    );
    console.log(
      `Verified ${Math.min(offset + batch.length, names.length)}/${names.length} atlases`,
    );
  }
  for (const sheet of sheets) {
    const name = basename(sheet.image);
    const size = bounds.get(name)!;
    const layout = catalog.layouts[sheet.layout]!;
    for (const frame of Object.values(layout.clips).flat(2)) {
      if (
        ((frame % layout.columns) + 1) * layout.cell > size.width ||
        (Math.floor(frame / layout.columns) + 1) * layout.cell > size.height
      ) {
        throw new Error(`Frame outside atlas bounds: ${name}`);
      }
    }
    sheet.image = urls.get(name)!;
  }
  const credits = await readFile(`${directory}/credits.json`);
  const id = `lpc-credits-${createHash("sha256").update(credits).digest("hex").slice(0, 24)}.json`;
  if (!uploads[id]) {
    const result = await utapi.uploadFiles(
      new UTFile([credits], id, {
        type: "application/json",
        customId: id,
      }),
    );
    if (!result.data) throw new Error(`Credits upload failed: ${result.error.message}`);
    uploads[id] = servedUfsUrl(result.data);
    await writeFile(checkpoint, `${JSON.stringify(uploads, null, 2)}\n`);
  }
  const response = await fetchWithRetry(uploads[id]!, {}, 30_000, {
    deadlineMs: 100_000,
  });
  if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(credits)) {
    throw new Error("Uploaded attribution differs from the staged credits");
  }
  catalog.creditsUrl = uploads[id];
  await writeFile("src/libs/lpc/credits.json", credits);
  await writeFile("src/libs/lpc/catalog.json", `${JSON.stringify(catalog)}\n`);
  console.log(
    JSON.stringify({
      atlases: names.length,
      originalBytes,
      compressedBytes,
      savedPercent: Math.round((1 - compressedBytes / originalBytes) * 100),
    }),
  );
};

await main();
