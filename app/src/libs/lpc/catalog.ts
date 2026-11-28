import { lpcAtlasFrame } from "@/libs/lpc/frames";
import type {
  LpcAnimation,
  LpcDirection,
  LpcMaterial,
  SpriteAppearance,
  SpriteLayer,
} from "@/validators/lpc";
import type { LpcAssetSheet, LpcConfig, LpcLayout } from "@/validators/lpcAsset";
import { lpcBodyParts } from "@/validators/lpcAsset";

/** Authored attack columns share one clock across weapons, bodies and clothing. */
export const LPC_ATTACK_FRAME_MS = 80;

/** Authored idle holds are sampled together across every visible layer of an actor. */
export const LPC_IDLE_FRAME_MS = 200;

/** A layer's full poses and its optional movement-only atlas share the same visual selection. */
export type LpcSheet = {
  image: string;
  intensityTint?: [number, number, number];
  depth?: string;
  bodyRegions?: boolean;
  palette?: number;
  z: number;
  layout: number;
  travel?: LpcSheet;
  offhand?: LpcSheet;
  part?: string;
  material?: LpcMaterial;
  component?: string;
};
/** A scene owns one resolved database snapshot, keeping all its actors on the same artwork. */
export type LpcCatalog = {
  entries: Record<string, LpcSheet[]>;
  layouts: LpcLayout[];
  palettes?: NonNullable<LpcAssetSheet["palette"]>[];
  designs: Record<
    string,
    Pick<
      LpcConfig,
      | "category"
      | "replacementSlots"
      | "replacesBodyParts"
      | "defaultColor"
      | "defaultEyes"
      | "preview"
    >
  >;
};

/** Compile saved design variants into the renderer's compact shared-layout lookup. */
export const buildLpcCatalog = (
  assets: { id: string; lpcConfig: LpcConfig | null }[],
): LpcCatalog => {
  const catalog: LpcCatalog = { entries: {}, layouts: [], palettes: [], designs: {} };
  const layouts = new Map<string, number>();
  const palettes = new Map<string, number>();
  const paletteId = (palette: NonNullable<LpcAssetSheet["palette"]>) => {
    const key = JSON.stringify(palette);
    let id = palettes.get(key);
    if (id === undefined) {
      id = catalog.palettes!.length;
      palettes.set(key, id);
      catalog.palettes!.push(palette);
    }
    return id;
  };
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
  const compileAtlas = (
    atlas: Pick<
      LpcAssetSheet,
      | "image"
      | "intensityTint"
      | "depth"
      | "bodyRegions"
      | "palette"
      | "z"
      | "layout"
      | "offhand"
    >,
  ): LpcSheet => ({
    image: atlas.image,
    ...(atlas.intensityTint ? { intensityTint: atlas.intensityTint } : {}),
    z: atlas.z,
    layout: layoutId(atlas.layout),
    ...(atlas.depth ? { depth: atlas.depth } : {}),
    ...(atlas.bodyRegions ? { bodyRegions: true } : {}),
    ...(atlas.palette ? { palette: paletteId(atlas.palette) } : {}),
    ...(atlas.offhand ? { offhand: compileAtlas(atlas.offhand) } : {}),
  });
  for (const asset of assets) {
    const config = asset.lpcConfig;
    // Newly created LPC assets can remain unfinished drafts until their first valid save.
    if (!config) continue;
    catalog.designs[asset.id] = {
      category: config.category,
      replacementSlots: config.replacementSlots,
      ...(config.replacesBodyParts
        ? { replacesBodyParts: config.replacesBodyParts }
        : {}),
      defaultColor: config.defaultColor,
      defaultEyes: config.defaultEyes,
      ...(config.preview ? { preview: config.preview } : {}),
    };
    for (const [key, sheets] of Object.entries(config.variants))
      catalog.entries[`${asset.id}/${key}`] = sheets.map((sheet) => ({
        ...compileAtlas(sheet),
        ...(sheet.part ? { part: sheet.part } : {}),
        ...(sheet.material ? { material: sheet.material } : {}),
        ...(sheet.component ? { component: sheet.component } : {}),
        ...(sheet.travel
          ? {
              travel: compileAtlas(sheet.travel),
            }
          : {}),
      }));
  }
  return catalog;
};

/** Combine revision-checked design entries while sharing frame layouts across the scene. */
export const mergeLpcCatalogs = (sources: LpcCatalog[]): LpcCatalog => {
  const result: LpcCatalog = { entries: {}, layouts: [], palettes: [], designs: {} };
  const indices = new Map<string, number>();
  const palettes = new Map<string, number>();
  for (const source of sources) {
    const sheet = (entry: LpcSheet): LpcSheet => {
      const layout = source.layouts[entry.layout];
      if (!layout) throw new Error("Missing sprite layout in cached design");
      const key = JSON.stringify(layout);
      let index = indices.get(key);
      if (index === undefined) {
        index = result.layouts.length;
        indices.set(key, index);
        result.layouts.push(layout);
      }
      let paletteId: number | undefined;
      if (entry.palette !== undefined) {
        const palette = source.palettes?.[entry.palette];
        if (!palette) throw new Error("Missing character palette in cached design");
        const key = JSON.stringify(palette);
        paletteId = palettes.get(key);
        if (paletteId === undefined) {
          paletteId = result.palettes!.length;
          palettes.set(key, paletteId);
          result.palettes!.push(palette);
        }
      }
      return {
        ...entry,
        layout: index,
        ...(paletteId !== undefined ? { palette: paletteId } : {}),
        ...(entry.offhand ? { offhand: sheet(entry.offhand) } : {}),
        ...(entry.travel ? { travel: sheet(entry.travel) } : {}),
      };
    };
    Object.assign(result.designs, source.designs);
    for (const [key, entries] of Object.entries(source.entries))
      result.entries[key] = entries.map(sheet);
  }
  return result;
};

/** Keep each natural mesh section from the outermost, most specific visible garment. */
export const spriteBodyPartMasks = (catalog: LpcCatalog, layers: SpriteLayer[]) => {
  const owners = new Map<
    string,
    { layer: SpriteLayer; priority: number; sections: number }
  >();
  for (const layer of layers) {
    const design = catalog.designs[layer.profile];
    const sections = design?.replacesBodyParts ?? [];
    const priority =
      design?.category === "body"
        ? 0
        : ["shirt", "legs", "feet"].includes(layer.slot ?? "")
          ? 1
          : 2;
    for (const part of sections) {
      const previous = owners.get(part);
      if (
        !previous ||
        priority > previous.priority ||
        (priority === previous.priority && sections.length <= previous.sections)
      )
        owners.set(part, { layer, priority, sections: sections.length });
    }
  }
  return new Map(
    layers.map((layer) => [
      layer,
      new Set(
        lpcBodyParts.flatMap((part, index) => {
          const owner = owners.get(part);
          return owner && owner.layer !== layer ? [index + 1] : [];
        }),
      ),
    ]),
  );
};

/** Apply outfit replacement slots consistently before rendering, framing or loading preview media. */
export const visibleSpriteLayers = (
  catalog: LpcCatalog,
  appearance: SpriteAppearance,
) => {
  const replaced = new Set<string>(
    appearance.layers.flatMap((layer) =>
      (catalog.designs[layer.profile]?.replacementSlots ?? []).filter(
        (slot) => slot !== layer.slot,
      ),
    ),
  );
  return appearance.layers.filter((layer) => !layer.slot || !replaced.has(layer.slot));
};

/** Restore editable variants from shared tables for editor delivery and bundled asset seeds. */
export const expandLpcDesignVariants = (
  catalog: LpcCatalog,
  id: string,
): LpcConfig["variants"] => {
  const expand = (sheet: LpcSheet): LpcAssetSheet => {
    const { layout: index, palette: paletteIndex, travel, offhand, ...atlas } = sheet;
    const layout = catalog.layouts[index];
    if (!layout) throw new Error("Missing character layout reference");
    const palette =
      paletteIndex === undefined ? undefined : catalog.palettes?.[paletteIndex];
    if (paletteIndex !== undefined && !palette)
      throw new Error("Missing character palette reference");
    return {
      ...atlas,
      layout,
      ...(palette ? { palette } : {}),
      ...(travel ? { travel: expand(travel) } : {}),
      ...(offhand ? { offhand: expand(offhand) } : {}),
    };
  };
  return Object.fromEntries(
    Object.entries(catalog.entries)
      .filter(([key]) => key.startsWith(`${id}/`))
      .map(([key, sheets]) => [key.slice(id.length + 1), sheets.map(expand)]),
  );
};

/** Missing colours resolve to the design's authored default palette. */
export const spriteLayerSheets = (
  lpcCatalog: LpcCatalog,
  appearance: SpriteAppearance,
  layer: SpriteLayer,
  mode: "all" | "travel" = "all",
): LpcSheet[] => {
  const design = lpcCatalog.designs[layer.profile];
  const sheets = resolveLpcVariantSheets(
    (color, eyes) =>
      lpcCatalog.entries[`${layer.profile}/${appearance.body}/${color}/${eyes}`],
    design,
    layer,
  );
  if (!sheets)
    throw new Error(
      `Sprite selection is unavailable: ${layer.profile}/${appearance.body}/${layer.color}/${layer.eyes ?? design?.defaultEyes ?? "blue"}`,
    );
  const selected =
    mode === "travel"
      ? sheets.flatMap((sheet) =>
          sheet.travel
            ? [
                {
                  ...sheet.travel,
                  ...(sheet.part ? { part: sheet.part } : {}),
                  ...(sheet.material ? { material: sheet.material } : {}),
                  ...(sheet.component ? { component: sheet.component } : {}),
                },
              ]
            : [],
        )
      : sheets;
  const characterPalette = {
    skin:
      (
        appearance.layers.find(
          (entry) => lpcCatalog.designs[entry.profile]?.category === "body",
        ) ??
        appearance.layers.find(
          (entry) => lpcCatalog.designs[entry.profile]?.category === "head",
        )
      )?.color ?? "light",
    hair:
      appearance.layers.find((entry) =>
        ["hair", "beard"].includes(lpcCatalog.designs[entry.profile]?.category ?? ""),
      )?.color ?? "black",
    eyes:
      appearance.layers.find(
        (entry) => lpcCatalog.designs[entry.profile]?.category === "head",
      )?.eyes ?? "blue",
  };
  const resolvePalette = (sheet: LpcSheet): LpcSheet => {
    const palette =
      sheet.palette !== undefined ? lpcCatalog.palettes?.[sheet.palette] : undefined;
    return {
      ...sheet,
      image: palette?.images[characterPalette[palette.channel]] ?? sheet.image,
      ...(palette?.intensityTints?.[characterPalette[palette.channel]]
        ? { intensityTint: palette.intensityTints[characterPalette[palette.channel]] }
        : {}),
      ...(sheet.offhand ? { offhand: resolvePalette(sheet.offhand) } : {}),
    };
  };
  return selected.map(resolvePalette);
};

/** Resolve base and material palettes together, retaining the eyes of the selected base. */
export const resolveLpcVariantSheets = <T extends Pick<LpcSheet, "part" | "material">>(
  sheetsFor: (color: string, eyes: string) => T[] | undefined,
  defaults: Pick<LpcConfig, "defaultColor" | "defaultEyes"> | undefined,
  selection: Pick<SpriteLayer, "color" | "eyes" | "materialColors">,
): T[] | undefined => {
  const defaultEyes = defaults?.defaultEyes ?? "blue";
  const eyes = selection.eyes ?? defaultEyes;
  const color = selection.color === "blonde" ? "yellow" : selection.color;
  const requested = sheetsFor(color, eyes);
  const base = requested ?? sheetsFor(defaults?.defaultColor ?? "gray", defaultEyes);
  const baseEyes = requested ? eyes : defaultEyes;
  return base?.map((sheet) => {
    const selected = sheet.material && selection.materialColors?.[sheet.material];
    if (!selected || !sheet.part) return sheet;
    return (
      sheetsFor(selected, baseEyes)?.find(
        (candidate) =>
          candidate.part === sheet.part && candidate.material === sheet.material,
      ) ?? sheet
    );
  });
};

/** Authored pose duration shared by sampling and retained actor updates. */
export const lpcFrameDuration = (state: LpcAnimation, layout?: LpcLayout) =>
  layout?.frameMs?.[state] ??
  (state === "walk"
    ? 180
    : state === "idle" || state === "combat"
      ? LPC_IDLE_FRAME_MS
      : LPC_ATTACK_FRAME_MS);

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
  const facing = layout.facings?.[direction];
  const row = facing?.row ?? (direction === 4 ? 1 : direction === 5 ? 3 : direction);
  const animation = ([state, "stand", "idle", "walk"] as const).find(
    (name) => layout.clips[name]?.[row]?.length,
  );
  const frames = animation ? layout.clips[animation]?.[row] : undefined;
  if (!frames?.length) return null;
  const duration = lpcFrameDuration(state, layout);
  const step = reducedMotion ? 0 : Math.floor(Math.max(0, elapsed) / duration);
  const index =
    state === "idle" || state === "combat" || state === "walk"
      ? step % frames.length
      : Math.min(step, frames.length - 1);
  const frame = frames[index] ?? frames[0];
  if (frame === undefined) return null;
  return {
    ...lpcAtlasFrame(layout, animation ?? state, frame),
    ...(facing?.mirror ? { mirror: true } : {}),
  };
};

/** Reflect a facing when sampling the opposite hand's mirrored equipment. */
export const lpcOppositeFacing = (direction: LpcDirection): LpcDirection =>
  ([0, 3, 2, 1, 5, 4] as const)[direction];

/** World coordinates use Y-up; six equal sectors align movement with the hex neighbours. */
export const lpcFacing = (
  dx: number,
  dy: number,
  fallback: LpcDirection = 2,
): LpcDirection =>
  Math.hypot(dx, dy) < 0.001
    ? fallback
    : Math.abs(dx) <= Math.abs(dy) / Math.sqrt(3)
      ? dy > 0
        ? 0
        : 2
      : dy > 0
        ? dx < 0
          ? 4
          : 5
        : dx < 0
          ? 1
          : 3;
