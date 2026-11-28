import {
  type LpcCatalog,
  lpcFrame,
  lpcFrameDuration,
  lpcOppositeFacing,
  spriteLayerSheets,
  visibleSpriteLayers,
} from "@/libs/lpc/catalog";
import { characterFrameOffset } from "@/libs/rendering/characterFrame";
import type { LpcAnimation, LpcDirection, SpriteAppearance } from "@/validators/lpc";

export const CHARACTER_PREVIEW_WIDTH = 256;
export const CHARACTER_PREVIEW_HEIGHT = 320;

/** Fit the complete pose envelope so turning or playing a clip never changes the zoom. */
export const characterPreviewFraming = (
  catalog: LpcCatalog,
  appearance: SpriteAppearance,
  animation: LpcAnimation,
) => {
  const boxes: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const layer of visibleSpriteLayers(catalog, appearance)) {
    const selected = spriteLayerSheets(
      catalog,
      appearance,
      layer,
      ["stand", "idle", "walk"].includes(animation) ? "travel" : "all",
    );
    const offhand = !!layer.mirror && selected.every((sheet) => !!sheet.offhand);
    const sheets = offhand
      ? selected.map((sheet) => ({
          ...sheet.offhand!,
          ...(sheet.component ? { component: sheet.component } : {}),
        }))
      : selected;
    for (const sheet of sheets) {
      // Split attack sheets must not contribute their neutral fallback to another clip.
      if (
        !catalog.layouts[sheet.layout]?.clips[animation] &&
        sheets.some(
          (other) =>
            other.component === sheet.component &&
            catalog.layouts[other.layout]?.clips[animation],
        )
      )
        continue;
      for (const direction of [0, 1, 2, 3, 4, 5] as const) {
        const facing: LpcDirection =
          layer.mirror && !offhand ? lpcOppositeFacing(direction) : direction;
        const layout = catalog.layouts[sheet.layout]!;
        const count = layout.cells
          ? Math.max(1, ...(layout.clips[animation] ?? []).map((row) => row.length))
          : 1;
        for (let step = 0; step < count; step++) {
          const frame = lpcFrame(
            catalog,
            sheet,
            animation,
            facing,
            (step + 0.5) * lpcFrameDuration(animation, layout),
          );
          if (!frame) continue;
          const mirrored = (!!layer.mirror && !offhand) !== !!frame.mirror;
          const ppu = catalog.layouts[sheet.layout]?.pixelsPerUnit ?? 64;
          const origin = characterFrameOffset(frame, ppu, mirrored);
          const trim = frame.trim ?? {
            x: 0,
            y: 0,
            width: frame.size,
            height: frame.size,
          };
          const left = (trim.x - frame.size / 2) / ppu;
          const right = left + trim.width / ppu;
          const top = origin.y + (trim.y - frame.size / 2) / ppu;
          boxes.push({
            left: origin.x + (mirrored ? -right : left),
            right: origin.x + (mirrored ? -left : right),
            top,
            bottom: top + trim.height / ppu,
          });
        }
      }
    }
  }
  const left = Math.min(0, ...boxes.map((box) => box.left));
  const right = Math.max(0, ...boxes.map((box) => box.right));
  const top = Math.min(0, ...boxes.map((box) => box.top));
  const bottom = Math.max(0, ...boxes.map((box) => box.bottom));
  // A small accessory shown alone retains a sensible inspection scale.
  const scale = Math.min(
    320,
    (CHARACTER_PREVIEW_WIDTH - 32) / Math.max(right - left, 0.01),
    (CHARACTER_PREVIEW_HEIGHT - 40) / Math.max(bottom - top, 0.01),
  );
  return {
    x: CHARACTER_PREVIEW_WIDTH / 2 - ((left + right) / 2) * scale,
    y: CHARACTER_PREVIEW_HEIGHT / 2 - ((top + bottom) / 2) * scale,
    scale,
  };
};
