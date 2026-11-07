import { nanoid } from "nanoid";
import { UTApi, UTFile } from "uploadthing/server";
import {
  readSpriteSheetSize,
  resizeSpriteSheet,
  SPRITE_SHEET_LARGE_CELL,
  SPRITE_SHEET_SMALL_CELL,
  spriteSheetCell,
} from "@/libs/spriteSheetSizes";
import { isBunnyCdnUrl, transformImageUrl } from "@/utils/image";

/** Matches `spriteAnimationUploader`, so an uploaded sheet always fits. */
const MAX_SHEET_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Prepare the two raw sheets battles load, so staff supply one resolution.
 * Only our own CDN hosts are fetched: this runs on a pasted URL, and redirects are refused
 * so a sheet cannot point the server elsewhere.
 */
export const prepareSpriteSheetUrls = async (
  input: { url: string; columns: number; rows: number; frameCount: number },
  upload: (sheet: Buffer, name: string) => Promise<string> = uploadToStorage,
): Promise<SpriteSheetUrls> => {
  const url = transformImageUrl(input.url);
  if (!isBunnyCdnUrl(url))
    return {
      success: false,
      message: "Upload the sheet here instead of linking to it",
    };
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok)
    return { success: false, message: "The sprite sheet could not be downloaded" };
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length > MAX_SHEET_BYTES)
    return { success: false, message: "The sprite sheet is larger than 8MB" };
  const size = await readSpriteSheetSize(image).catch(() => null);
  const cell = size && spriteSheetCell(size, input);
  if (!cell)
    return {
      success: false,
      message: "The image does not divide into equal square cells for this grid",
    };
  // A sheet this small already fits both sizes, and enlarging it would add no detail.
  if (cell <= SPRITE_SHEET_SMALL_CELL) return { success: true, url, smallUrl: url };
  const uploadSize = async (size: number) =>
    upload(
      await resizeSpriteSheet(image, input, size),
      `sprite-sheet-${nanoid()}-${size}.webp`,
    );
  const [large, small] = await Promise.all([
    cell > SPRITE_SHEET_LARGE_CELL ? uploadSize(SPRITE_SHEET_LARGE_CELL) : url,
    uploadSize(SPRITE_SHEET_SMALL_CELL),
  ]).catch(() => [null, null]);
  if (!large || !small)
    return { success: false, message: "The sprite sheet could not be resized" };
  return { success: true, url: large, smallUrl: small };
};

/** Raw file-key URLs bypass the CDN optimizer, keeping packed atlases byte-identical. */
export const uploadToStorage = async (sheet: Buffer, name: string) => {
  const file = new UTFile([new Uint8Array(sheet)], name, { type: "image/webp" });
  const { data, error } = await new UTApi().uploadFiles(file);
  if (error || !data) throw new Error(error?.message ?? "Sprite sheet upload failed");
  return `https://uploadthing.b-cdn.net/f/${data.key}`;
};

/** Remove sheets nothing references; a file left behind only costs storage. */
export const removeFromStorage = async (urls: string[]) => {
  const keys = urls.flatMap((url) => new URL(url).pathname.split("/").slice(-1));
  await new UTApi().deleteFiles(keys).catch(() => undefined);
};

type SpriteSheetUrls =
  | { success: true; url: string; smallUrl: string }
  | { success: false; message: string };
