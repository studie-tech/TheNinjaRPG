import { buildLpcCatalog, lpcFrame, spriteLayerSheets } from "@/libs/lpc/catalog";
import { loadLpcPreviewCatalog } from "@/libs/lpc/previewAssets";
import { composeCharacterPixels } from "@/libs/rendering/characterDepth";
import { textureImageUrl } from "@/utils/image";
import type { LpcBody } from "@/validators/lpc";
import type { LpcConfig } from "@/validators/lpcAsset";

/** Read only a neutral frame into canvas memory; large decoded atlas bitmaps are released immediately. */
const readFrame = async (
  url: string,
  frame: { x: number; y: number; width: number; height: number },
  signal: AbortSignal,
) => {
  const response = await fetch(textureImageUrl(url, 0), { signal });
  if (!response.ok) throw new Error("Could not load character thumbnail artwork");
  const bitmap = await createImageBitmap(
    await response.blob(),
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    { colorSpaceConversion: "none", premultiplyAlpha: "none" },
  );
  try {
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Character thumbnail canvas unavailable");
    context.drawImage(bitmap, 0, 0);
    return new Uint8Array(context.getImageData(0, 0, frame.width, frame.height).data);
  } finally {
    bitmap.close();
  }
};

/** Compose edited depth-aware designs without allocating one WebGL context per gallery card. */
export const renderLpcThumbnail = async (
  config: LpcConfig,
  signal: AbortSignal,
  body: LpcBody = "male",
) => {
  const base = buildLpcCatalog([{ id: "thumbnail", lpcConfig: config }]);
  const layer = {
    profile: "thumbnail",
    color: config.defaultColor,
    eyes: config.defaultEyes,
  };
  const appearance = { version: 1 as const, body, layers: [layer] };
  const catalog = await loadLpcPreviewCatalog(base, appearance, "stand", signal).catch(
    (cause: unknown) => {
      if (signal.aborted) throw cause;
      // Gallery cards retain their gameplay-resolution image if detailed media is unavailable.
      return base;
    },
  );
  const sheets = spriteLayerSheets(catalog, appearance, layer);
  const hasStand = sheets.some((sheet) => catalog.layouts[sheet.layout]?.clips.stand);
  const parts = sheets.flatMap((sheet) => {
    const layout = catalog.layouts[sheet.layout]!;
    if (hasStand && !layout.clips.stand) return [];
    const frame = lpcFrame(catalog, sheet, "stand", 2, 0, true);
    if (!frame || !sheet.depth) return [];
    return [{ sheet, layout, frame }];
  });
  if (!parts.length) throw new Error("No character thumbnail pose available");
  // Release each decoded atlas before requesting the next layer.
  const layers = [];
  for (const { sheet, layout, frame } of parts) {
    signal.throwIfAborted();
    const pixels = await readFrame(sheet.image, frame, signal);
    const depth = await readFrame(sheet.depth!, frame, signal);
    layers.push({
      pixels,
      depth,
      width: frame.width,
      height: frame.height,
      pixelsPerUnit: layout.pixelsPerUnit ?? 64,
      mirror: !!frame.mirror,
      z: sheet.z,
      ...(sheet.intensityTint ? { intensityTint: sheet.intensityTint } : {}),
      ...(sheet.bodyRegions ? { bodyRegions: new Set<number>() } : {}),
      frame: { ...frame, x: 0, y: 0 },
    });
  }
  const size = Math.max(...parts.map(({ frame }) => frame.size));
  const pixelsPerUnit = Math.max(...layers.map((layer) => layer.pixelsPerUnit));
  return { size, pixels: composeCharacterPixels(layers, size, pixelsPerUnit) };
};
