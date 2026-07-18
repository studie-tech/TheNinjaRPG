/**
 * Upload a generated map asset to UploadThing and print the CDN URL to paste
 * into `@/drizzle/constants.ts`. It is the "publish" step of the map-asset
 * workflow: regenerate an asset -> run this to push it to the CDN -> paste the
 * printed url into the matching constant.
 *
 * The two assets that go through here:
 *   - the world topology `src/data/hexasphere.json` (produced by
 *     scripts/generate-globe.ts) -> paste into IMG_MAP_HEXASPHERE, then bump
 *     MAP_CACHE_VERSION in libs/threejs/globe.ts. This is the file the server
 *     imports and the client fetches from the CDN, so it is uploaded whenever
 *     the world is regenerated.
 *   - the globe coastline atlas PNG -> paste into IMG_MAP_TILESET_ATLAS.
 *
 * Map assets are served from UploadThing's CDN (uploadthing.b-cdn.net), never
 * from the Next.js `public/` folder — the CDN is far cheaper than serving
 * static assets through Vercel, and it keeps generated binaries out of the repo.
 *
 * Usage:
 *   bun run scripts/upload-map-asset.ts <path-to-file> [content-type]
 *
 * Examples:
 *   bun run scripts/upload-map-asset.ts src/data/hexasphere.json application/json
 *   bun run scripts/upload-map-asset.ts scripts/.artifacts/globe-atlas.png image/png
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { UTApi } from "uploadthing/server";

const CDN_HOST = "https://uploadthing.b-cdn.net";

/** Infer the MIME type from the file extension, falling back to application/octet-stream for unknown extensions */
const guessContentType = (name: string): string => {
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
};

/** CLI entry: read the file, upload it to UploadThing, print key + CDN url */
const main = async () => {
  const [, , filePath, explicitType] = process.argv;
  if (!filePath) {
    console.error(
      "Usage: bun run scripts/upload-map-asset.ts <path-to-file> [content-type]",
    );
    process.exit(1);
  }

  const name = basename(filePath);
  const contentType = explicitType ?? guessContentType(name);
  const bytes = readFileSync(filePath);
  const file = new File([bytes], name, { type: contentType });

  const utapi = new UTApi();
  const result = await utapi.uploadFiles(file);
  if (result.error || !result.data) {
    console.error("Upload failed:", result.error);
    process.exit(1);
  }

  const { key, ufsUrl } = result.data;
  const cdnUrl = `${CDN_HOST}/f/${key}`;
  console.log(`Uploaded ${name} (${bytes.length} bytes)`);
  console.log(`  key:     ${key}`);
  console.log(`  ufsUrl:  ${ufsUrl}`);
  console.log(`  cdn url: ${cdnUrl}`);
};

void main();
