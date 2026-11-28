import { createHash } from "node:crypto";
import { lpcAtlasResources } from "@/libs/lpc/atlases";
import { lpcAtlasFrame } from "@/libs/lpc/frames";
import { UPLOADTHING_HOST } from "@/libs/uploadthing";
import { validateUrlForSsrf } from "@/server/utils/ssrf";
import { chunkArray } from "@/utils/array";
import { canonicalJson } from "@/utils/canonicalJson";
import { textureImageUrl } from "@/utils/image";
import { withRetry } from "@/utils/retry";
import type { LpcAnimation } from "@/validators/lpc";
import type { LpcAssetSheet, LpcConfig, LpcLayout } from "@/validators/lpcAsset";
import { lpcLayoutValidator } from "@/validators/lpcAsset";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Read only first-party immutable files, with bounded bytes, time and redirect handling. */
export const readLpcImage = async (url: string) => {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    ![
      new URL(UPLOADTHING_HOST).hostname,
      "uploadthing.b-cdn.net",
      "tnr-storage-cdn.b-cdn.net",
    ].includes(parsed.hostname) ||
    !/^\/f\/[a-zA-Z0-9_.-]+$/.test(parsed.pathname) ||
    parsed.search ||
    !(await validateUrlForSsrf(url))
  )
    throw new Error("Choose an image uploaded to the game.");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body)
    throw new Error("Could not download the sheet. Try uploading it again.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Sheets must be at most 8 MB.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
};

/** Require decodable atlas pixels within the declared layout and bounded image dimensions. */
export const validateLpcAtlas = async (
  bytes: Buffer,
  layout: LpcLayout,
  numerical = false,
) => {
  lpcLayoutValidator.parse(layout);
  const { default: sharp } = await import("sharp");
  const image = sharp(bytes, { limitInputPixels: 2048 * 2048 });
  const metadata = await image.metadata();
  if (
    !["png", "webp"].includes(metadata.format ?? "") ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 2048 ||
    metadata.height > 2048 ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error("Packed sheets must be single-frame PNG/WebP images up to 2048px.");
  if (
    numerical &&
    (metadata.format !== "png" || metadata.depth !== "uchar" || metadata.icc)
  )
    throw new Error(
      "Character depth must be an eight-bit PNG without a colour profile.",
    );
  const width = layout.trim?.width ?? layout.cell,
    height = layout.trim?.height ?? layout.cell,
    gutter = layout.trim ? 2 : 0;
  if (
    (!layout.regions &&
      !layout.cells &&
      layout.columns * (width + gutter) > metadata.width) ||
    Object.entries(layout.clips).some(([animation, rows]) =>
      rows.flat().some((index) => {
        const frame = lpcAtlasFrame(layout, animation as LpcAnimation, index),
          padding = frame.trim ? 1 : 0;
        return (
          frame.x + frame.width + padding > metadata.width ||
          frame.y + frame.height + padding > metadata.height
        );
      }),
    )
  )
    throw new Error("The animation layout extends outside the uploaded image.");
  const decoded = await image.ensureAlpha().raw().toBuffer();
  if (numerical)
    for (let index = 3; index < decoded.length; index += 4)
      if (decoded[index] !== 255)
        throw new Error("Character depth must have an opaque alpha channel.");
};

/** Convert the standard 13-column LPC export's supported poses into a bounded atlas. */
export const packStandardLpc = async (bytes: Buffer) => {
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(bytes, {
    limitInputPixels: 16 * 1024 * 1024,
  }).metadata();
  if (
    metadata.format !== "png" ||
    metadata.width !== 832 ||
    !metadata.height ||
    metadata.height < 1344 ||
    metadata.height % 64 ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error(
      "Standard LPC exports must be PNGs with 13 columns of 64px cells and at least 21 rows (832 × 1344px).",
    );
  const source = await sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  // Standard exports reserve the first walk column for standing and share one hurt row.
  const poses: [LpcAnimation, number, number[]][] = [
    ["stand", 8, [0]],
    ["walk", 8, [1, 2, 3, 4, 5, 6, 7, 8]],
    ["spellcast", 0, [0, 1, 2, 3, 4, 5, 6]],
    ["thrust", 4, [0, 1, 2, 3, 4, 5, 6, 7]],
    ["slash", 12, [0, 1, 2, 3, 4, 5]],
    ["shoot", 16, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
    ["hurt", 20, [0, 1, 2, 3, 4, 5]],
    ["idle", 22, [0, 0, 1]],
    ["combat", 42, [0, 0, 1]],
  ];
  const frames: Buffer[] = [],
    clips: LpcLayout["clips"] = {};
  for (const [animation, firstRow, columns] of poses) {
    if ((firstRow + (animation === "hurt" ? 1 : 4)) * 64 > metadata.height) continue;
    const firstFrame = frames.length;
    const directions: number[][] = [];
    let hasVisiblePixels = false;
    for (let direction = 0; direction < 4; direction++) {
      const indices: number[] = [];
      const repeated = new Map<number, number>();
      for (const column of columns) {
        const previous = repeated.get(column);
        if (previous !== undefined) {
          indices.push(previous);
          continue;
        }
        const index = frames.length;
        const x = column * 64,
          y = (firstRow + (animation === "hurt" ? 0 : direction)) * 64;
        const frame = Buffer.alloc(64 * 64 * 4);
        for (let row = 0; row < 64; row++)
          source.copy(
            frame,
            row * 64 * 4,
            ((y + row) * 832 + x) * 4,
            ((y + row) * 832 + x + 64) * 4,
          );
        for (let alpha = 3; alpha < frame.length && !hasVisiblePixels; alpha += 4)
          if (frame[alpha]) hasVisiblePixels = true;
        repeated.set(column, index);
        frames.push(frame);
        indices.push(index);
      }
      directions.push(indices);
    }
    // Empty reserved rows are absent poses, so the renderer can use its held-pose fallback.
    if (hasVisiblePixels) clips[animation] = directions;
    else frames.length = firstFrame;
  }
  if (!clips.stand || !clips.walk)
    throw new Error(
      "Provide visible standing and walking artwork before importing this sheet.",
    );
  const width = 1024,
    height = Math.ceil(frames.length / 16) * 64,
    output = Buffer.alloc(width * height * 4);
  frames.forEach((frame, index) => {
    for (let row = 0; row < 64; row++)
      frame.copy(
        output,
        ((Math.floor(index / 16) * 64 + row) * width + (index % 16) * 64) * 4,
        row * 64 * 4,
        (row + 1) * 64 * 4,
      );
  });
  return {
    bytes: await sharp(output, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    layout: { cell: 64, columns: 16, clips } satisfies LpcLayout,
  };
};

/** Build a trimmed, deduplicated movement atlas with extruded texels for WebGL sampling. */
export const packLpcTravel = async (bytes: Buffer, layout: LpcLayout) => {
  if (!layout.clips.stand || !layout.clips.walk) return undefined;
  const { default: sharp } = await import("sharp");
  const decoded = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = decoded,
    cell = layout.cell;
  const selected: Partial<Record<LpcAnimation, number[][]>> = {};
  for (const animation of ["stand", "idle", "walk"] as const)
    if (layout.clips[animation]) selected[animation] = layout.clips[animation];
  const indices = Object.entries(selected).flatMap(([animation, rows]) =>
      [...new Set(rows.flat())].map((index) => ({
        animation: animation as LpcAnimation,
        index,
        key: `${animation}:${index}`,
      })),
    ),
    frames = new Map<string, Buffer>();
  let left: number = cell,
    top: number = cell,
    right = 0,
    bottom = 0;
  // Reconstruct logical cells before measuring a crop shared by every movement pose.
  for (const { animation, index, key } of indices) {
    const frame = Buffer.alloc(cell * cell * 4),
      source = lpcAtlasFrame(layout, animation, index),
      trim = source.trim;
    const { width, height, x: sx, y: sy } = source;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = ((sy + y) * info.width + sx + x) * 4,
          dx = x + (trim?.x ?? 0),
          dy = y + (trim?.y ?? 0);
        if (!data[at + 3]) continue;
        data.copy(frame, (dy * cell + dx) * 4, at, at + 4);
        left = Math.min(left, dx);
        top = Math.min(top, dy);
        right = Math.max(right, dx + 1);
        bottom = Math.max(bottom, dy + 1);
      }
    frames.set(key, frame);
  }
  if (!right) {
    left = 0;
    top = 0;
    right = 1;
    bottom = 1;
  }
  const width = right - left,
    height = bottom - top,
    unique: Buffer[] = [],
    hashes = new Map<string, number>(),
    remap = new Map<string, number>();
  // Identical cells share storage; remap clips without changing their authored pose order.
  for (const [index, frame] of frames) {
    const hash = createHash("sha256").update(frame).digest("hex");
    let packed = hashes.get(hash);
    if (packed === undefined) {
      packed = unique.length;
      hashes.set(hash, packed);
      unique.push(frame);
    }
    remap.set(index, packed);
  }
  const columns = Math.max(
      1,
      Math.min(16, Math.floor(2048 / (width + 2)), unique.length),
    ),
    atlasWidth = columns * (width + 2),
    atlasHeight = Math.ceil(unique.length / columns) * (height + 2);
  if (atlasHeight > 2048)
    throw new Error("Movement frames exceed the 2048px texture limit.");
  const output = Buffer.alloc(atlasWidth * atlasHeight * 4);
  // Repeat edge texels into the gutter so texture filtering cannot sample a neighbour's art.
  unique.forEach((frame, index) => {
    for (let y = -1; y <= height; y++)
      for (let x = -1; x <= width; x++) {
        const from =
          ((top + Math.max(0, Math.min(height - 1, y))) * cell +
            left +
            Math.max(0, Math.min(width - 1, x))) *
          4;
        const to =
          ((Math.floor(index / columns) * (height + 2) + 1 + y) * atlasWidth +
            (index % columns) * (width + 2) +
            1 +
            x) *
          4;
        frame.copy(output, to, from, from + 4);
      }
  });
  return {
    bytes: await sharp(output, {
      raw: { width: atlasWidth, height: atlasHeight, channels: 4 },
    })
      .png()
      .toBuffer(),
    layout: {
      cell,
      columns,
      clips: Object.fromEntries(
        Object.entries(selected).map(([animation, rows]) => [
          animation,
          rows.map((row) => row.map((index) => remap.get(`${animation}:${index}`)!)),
        ]),
      ),
      trim: { x: left, y: top, width, height },
      ...(layout.pixelsPerUnit ? { pixelsPerUnit: layout.pixelsPerUnit } : {}),
      ...(layout.ground ? { ground: layout.ground } : {}),
      ...(layout.facings ? { facings: layout.facings } : {}),
      ...(layout.frameMs
        ? {
            frameMs: Object.fromEntries(
              Object.entries(layout.frameMs).filter(
                ([animation]) => animation in selected,
              ),
            ),
          }
        : {}),
    } satisfies LpcLayout,
  };
};

/** Publish raw-key atlas URLs so CDN image optimization cannot alter sprite coordinates. */
const publishAtlas = async (bytes: Buffer) => {
  const { UTApi, UTFile } = await import("uploadthing/server");
  const upload = await new UTApi().uploadFiles(
    new UTFile(
      [new Uint8Array(bytes)],
      `lpc-${createHash("sha256").update(bytes).digest("hex")}.png`,
      { type: "image/png" },
    ),
  );
  if (!upload.data) throw new Error("Could not upload the processed sheet. Try again.");
  const url = upload.data.ufsUrl;
  const delivered = await withRetry(async () => {
    const response = await fetch(textureImageUrl(url, 0), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Media download failed (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  });
  if (!delivered.equals(bytes))
    throw new Error(
      "The sprite CDN changed the processed sheet. Upload again before saving.",
    );
  return url;
};

/** Prepare a replacement sheet and regenerate its compact movement companion before saving. */
export const prepareLpcSheet = async (input: {
  image: string;
  format: "standard" | "packed";
  layout?: LpcLayout;
  z: number;
}): Promise<LpcAssetSheet> => {
  const source = await readLpcImage(input.image);
  const packed =
    input.format === "standard"
      ? await packStandardLpc(source)
      : { bytes: source, layout: input.layout };
  if (!packed.layout) throw new Error("Provide the frame layout for a packed sheet.");
  await validateLpcAtlas(packed.bytes, packed.layout);
  const travel = await packLpcTravel(packed.bytes, packed.layout);
  const [image, travelImage] = await Promise.all([
    input.format === "standard"
      ? publishAtlas(packed.bytes)
      : Promise.resolve(input.image),
    travel ? publishAtlas(travel.bytes) : Promise.resolve(undefined),
  ]);
  return {
    image,
    z: input.z,
    layout: packed.layout,
    ...(travel && travelImage
      ? { travel: { image: travelImage, z: input.z, layout: travel.layout } }
      : {}),
  };
};

/**
 * Validate changed atlas/layout pairs while retaining already-verified saved files.
 * Canonical keys tolerate MySQL JSON key ordering; bounded batches limit decode memory.
 */
export const validateLpcImages = async (
  config: LpcConfig,
  previous?: LpcConfig | null,
) => {
  const saved = new Set(
    lpcAtlasResources(previous).map((sheet) =>
      canonicalJson([sheet.image, sheet.layout, sheet.numerical]),
    ),
  );
  const pending = [
    ...new Map(
      lpcAtlasResources(config)
        .filter(
          (sheet) =>
            !saved.has(canonicalJson([sheet.image, sheet.layout, sheet.numerical])),
        )
        .map((sheet) => [
          canonicalJson([sheet.image, sheet.layout, sheet.numerical]),
          sheet,
        ]),
    ).values(),
  ];
  for (const batch of chunkArray(pending, 5))
    await Promise.all(
      batch.map(async (sheet) =>
        validateLpcAtlas(
          await readLpcImage(sheet.image),
          sheet.layout,
          sheet.numerical,
        ),
      ),
    );
};
