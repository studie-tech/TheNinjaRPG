import source from "@/libs/lpc/catalog.json";
import type {
  LpcAnimation,
  LpcDirection,
  SpriteAppearance,
  SpriteLayer,
} from "@/validators/lpc";

export type LpcLayout = {
  cell: number;
  columns: number;
  clips: Partial<Record<LpcAnimation, number[][]>>;
};
export type LpcSheet = { image: string; z: number; layout: number; travel?: LpcSheet };
export const lpcCatalog = source as unknown as {
  revision: string;
  entries: Record<string, LpcSheet[]>;
  layouts: LpcLayout[];
};

/** Exact selections are bundled; missing legacy colours resolve to a valid authored palette. */
export const spriteLayerSheets = (
  appearance: SpriteAppearance,
  layer: SpriteLayer,
  mode: "all" | "travel" = "all",
): LpcSheet[] => {
  const head = layer.profile.startsWith("head-");
  const color = layer.color === "blonde" ? "yellow" : layer.color;
  const key = `${layer.profile}/${appearance.body}/${color}/${head ? (layer.eyes ?? "blue") : "blue"}`;
  const fallback = `${layer.profile}/${appearance.body}/${head || layer.profile === "body" ? "light" : "gray"}/blue`;
  const sheets = lpcCatalog.entries[key] ?? lpcCatalog.entries[fallback];
  if (!sheets) throw new Error(`Sprite selection is not bundled: ${key}`);
  return mode === "travel"
    ? sheets.flatMap((sheet) => (sheet.travel ? [sheet.travel] : []))
    : sheets;
};

export const lpcFrame = (
  sheet: LpcSheet,
  state: LpcAnimation,
  direction: LpcDirection,
  elapsed: number,
  reducedMotion = false,
) => {
  const layout = lpcCatalog.layouts[sheet.layout];
  if (!layout) throw new Error("Missing sprite layout");
  const frames =
    layout.clips[state]?.[direction] ??
    layout.clips.idle?.[direction] ??
    layout.clips.walk?.[direction];
  if (!frames?.length) return null;
  const duration = state === "walk" ? 90 : state === "idle" ? 200 : 80;
  const step = reducedMotion ? 0 : Math.floor(Math.max(0, elapsed) / duration);
  const index =
    state === "idle" || state === "walk"
      ? step % frames.length
      : Math.min(step, frames.length - 1);
  const frame = frames[index] ?? frames[0];
  if (frame === undefined) return null;
  return {
    x: (frame % layout.columns) * layout.cell,
    y: Math.floor(frame / layout.columns) * layout.cell,
    size: layout.cell,
  };
};

/** World coordinates use Y-up; LPC's row order is north, west, south, east. */
export const lpcFacing = (
  dx: number,
  dy: number,
  fallback: LpcDirection = 2,
): LpcDirection =>
  Math.hypot(dx, dy) < 0.001
    ? fallback
    : Math.abs(dx) > Math.abs(dy)
      ? dx < 0
        ? 1
        : 3
      : dy > 0
        ? 0
        : 2;
