import { createHash } from "node:crypto";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import { canonicalJson } from "@/libs/contentReview/version";
import { UPLOADTHING_HOST } from "@/libs/uploadthing";
import { chunkArray } from "@/utils/array";
import { validateUrlForSsrf } from "@/utils/ssrf";
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
export const validateLpcAtlas = async (bytes: Buffer, layout: LpcLayout) => {
  lpcLayoutValidator.parse(layout);
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
  const width = layout.trim?.width ?? layout.cell,
    height = layout.trim?.height ?? layout.cell,
    gutter = layout.trim ? 2 : 0;
  if (
    layout.columns * (width + gutter) > metadata.width ||
    Object.values(layout.clips)
      .flat(2)
      .some(
        (index) =>
          (Math.floor(index / layout.columns) + 1) * (height + gutter) >
          metadata.height,
      )
  )
    throw new Error("The animation layout extends outside the uploaded image.");
  await image.raw().toBuffer();
};

/** Convert the standard 13-column LPC export's supported poses into a bounded atlas. */
export const packStandardLpc = async (bytes: Buffer) => {
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
  const poses: [LpcAnimation, number, number][] = [
    ["stand", 8, 1],
    ["walk", 8, 8],
    ["spellcast", 0, 7],
    ["thrust", 4, 8],
    ["slash", 12, 6],
    ["shoot", 16, 13],
    ["hurt", 20, 6],
  ];
  const frames: Buffer[] = [],
    clips: LpcLayout["clips"] = {};
  for (const [animation, firstRow, count] of poses) {
    clips[animation] = [];
    for (let direction = 0; direction < 4; direction++) {
      const indices: number[] = [];
      for (let column = 0; column < count; column++) {
        const index = frames.length;
        const x = (column + (animation === "walk" ? 1 : 0)) * 64,
          y = (firstRow + (animation === "hurt" ? 0 : direction)) * 64;
        const frame = Buffer.alloc(64 * 64 * 4);
        for (let row = 0; row < 64; row++)
          source.copy(
            frame,
            row * 64 * 4,
            ((y + row) * 832 + x) * 4,
            ((y + row) * 832 + x + 64) * 4,
          );
        frames.push(frame);
        indices.push(index);
      }
      clips[animation]!.push(indices);
    }
  }
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
  const decoded = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = decoded,
    cell = layout.cell;
  const selected: Partial<Record<LpcAnimation, number[][]>> = {};
  for (const animation of ["stand", "idle", "walk"] as const)
    if (layout.clips[animation]) selected[animation] = layout.clips[animation];
  const indices = [...new Set(Object.values(selected).flat(2))],
    frames = new Map<number, Buffer>();
  let left: number = cell,
    top: number = cell,
    right = 0,
    bottom = 0;
  // Reconstruct logical cells before measuring a crop shared by every movement pose.
  for (const index of indices) {
    const frame = Buffer.alloc(cell * cell * 4),
      trim = layout.trim;
    const width = trim?.width ?? cell,
      height = trim?.height ?? cell,
      gutter = trim ? 1 : 0;
    const sx = (index % layout.columns) * (width + gutter * 2) + gutter,
      sy = Math.floor(index / layout.columns) * (height + gutter * 2) + gutter;
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
    frames.set(index, frame);
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
    remap = new Map<number, number>();
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
          rows.map((row) => row.map((index) => remap.get(index)!)),
        ]),
      ),
      trim: { x: left, y: top, width, height },
    } satisfies LpcLayout,
  };
};

/** Publish raw-key atlas URLs so CDN image optimization cannot alter sprite coordinates. */
const publishAtlas = async (bytes: Buffer) => {
  const upload = await new UTApi().uploadFiles(
    new UTFile(
      [new Uint8Array(bytes)],
      `lpc-${createHash("sha256").update(bytes).digest("hex")}.png`,
      { type: "image/png" },
    ),
  );
  if (!upload.data) throw new Error("Could not upload the processed sheet. Try again.");
  return upload.data.ufsUrl;
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
  const atlases = (value?: LpcConfig | null) =>
    Object.values(value?.variants ?? {})
      .flat()
      .flatMap((sheet) => [sheet, ...(sheet.travel ? [sheet.travel] : [])]);
  const saved = new Set(
    atlases(previous).map((sheet) => canonicalJson([sheet.image, sheet.layout])),
  );
  const pending = [
    ...new Map(
      atlases(config)
        .filter((sheet) => !saved.has(canonicalJson([sheet.image, sheet.layout])))
        .map((sheet) => [canonicalJson([sheet.image, sheet.layout]), sheet]),
    ).values(),
  ];
  for (const batch of chunkArray(pending, 5))
    await Promise.all(
      batch.map(async (sheet) =>
        validateLpcAtlas(await readLpcImage(sheet.image), sheet.layout),
      ),
    );
};
