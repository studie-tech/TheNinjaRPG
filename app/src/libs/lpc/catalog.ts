import type {
  LpcAnimation,
  LpcDirection,
  SpriteAppearance,
  SpriteLayer,
} from "@/validators/lpc";
import type { LpcConfig, LpcLayout } from "@/validators/lpcAsset";

/** Authored attack columns share one clock across weapons, bodies and clothing. */
export const LPC_ATTACK_FRAME_MS = 80;

/** Authored idle holds are sampled together across every visible layer of an actor. */
export const LPC_IDLE_FRAME_MS = 200;

/** A layer's full poses and its optional movement-only atlas share the same visual selection. */
export type LpcSheet = { image: string; z: number; layout: number; travel?: LpcSheet };
/** A scene owns one resolved database snapshot, keeping all its actors on the same artwork. */
export type LpcCatalog = {
  entries: Record<string, LpcSheet[]>;
  layouts: LpcLayout[];
  designs: Record<
    string,
    Pick<LpcConfig, "category" | "replacementSlot" | "defaultColor" | "defaultEyes">
  >;
};

/** Compile saved design variants into the renderer's compact shared-layout lookup. */
export const buildLpcCatalog = (
  assets: { id: string; lpcConfig: LpcConfig | null }[],
): LpcCatalog => {
  const catalog: LpcCatalog = { entries: {}, layouts: [], designs: {} };
  const layouts = new Map<string, number>();
  /** Reuse frame-layout indices across the snapshot's body, colour and eye variants. */
  const layoutId = (layout: LpcLayout) => {
    const key = JSON.stringify(layout);
    let id = layouts.get(key);
    if (id === undefined) {
      id = catalog.layouts.length;
      layouts.set(key, id);
      catalog.layouts.push(layout);
    }
    return id;
  };
  for (const asset of assets) {
    const config = asset.lpcConfig;
    // Newly created LPC assets can remain unfinished drafts until their first valid save.
    if (!config) continue;
    catalog.designs[asset.id] = {
      category: config.category,
      replacementSlot: config.replacementSlot,
      defaultColor: config.defaultColor,
      defaultEyes: config.defaultEyes,
    };
    for (const [key, sheets] of Object.entries(config.variants))
      catalog.entries[`${asset.id}/${key}`] = sheets.map((sheet) => ({
        image: sheet.image,
        z: sheet.z,
        layout: layoutId(sheet.layout),
        ...(sheet.travel
          ? {
              travel: {
                image: sheet.travel.image,
                z: sheet.travel.z,
                layout: layoutId(sheet.travel.layout),
              },
            }
          : {}),
      }));
  }
  return catalog;
};

/** Missing colours resolve to the design's authored default palette. */
export const spriteLayerSheets = (
  lpcCatalog: LpcCatalog,
  appearance: SpriteAppearance,
  layer: SpriteLayer,
  mode: "all" | "travel" = "all",
): LpcSheet[] => {
  const design = lpcCatalog.designs[layer.profile];
  const color = layer.color === "blonde" ? "yellow" : layer.color;
  const eyes = layer.eyes ?? design?.defaultEyes ?? "blue";
  const key = `${layer.profile}/${appearance.body}/${color}/${eyes}`;
  const fallback = `${layer.profile}/${appearance.body}/${design?.defaultColor ?? "gray"}/${design?.defaultEyes ?? "blue"}`;
  const sheets = lpcCatalog.entries[key] ?? lpcCatalog.entries[fallback];
  if (!sheets) throw new Error(`Sprite selection is unavailable: ${key}`);
  return mode === "travel"
    ? sheets.flatMap((sheet) => (sheet.travel ? [sheet.travel] : []))
    : sheets;
};

/**
 * Sample elapsed milliseconds: resting/walking cycles loop, attacks clamp, and reduced motion holds the first pose.
 * Missing clips use the neutral held pose; scene code owns cue expiry.
 */
export const lpcFrame = (
  lpcCatalog: LpcCatalog,
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
    layout.clips.stand?.[direction] ??
    layout.clips.idle?.[direction] ??
    layout.clips.walk?.[direction];
  if (!frames?.length) return null;
  const duration =
    state === "walk"
      ? 90
      : state === "idle" || state === "combat"
        ? LPC_IDLE_FRAME_MS
        : LPC_ATTACK_FRAME_MS;
  const step = reducedMotion ? 0 : Math.floor(Math.max(0, elapsed) / duration);
  const index =
    state === "idle" || state === "combat" || state === "walk"
      ? step % frames.length
      : Math.min(step, frames.length - 1);
  const frame = frames[index] ?? frames[0];
  if (frame === undefined) return null;
  const width = layout.trim?.width ?? layout.cell;
  const height = layout.trim?.height ?? layout.cell;
  const gutter = layout.trim ? 1 : 0;
  return {
    x: (frame % layout.columns) * (width + gutter * 2) + gutter,
    y: Math.floor(frame / layout.columns) * (height + gutter * 2) + gutter,
    size: layout.cell,
    width,
    height,
    trim: layout.trim,
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
