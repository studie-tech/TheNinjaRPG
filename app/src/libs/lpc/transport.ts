import {
  buildLpcCatalog,
  expandLpcDesignVariants,
  type LpcCatalog,
  type LpcSheet,
} from "@/libs/lpc/catalog";
import type { LpcAssetSheet, LpcConfig } from "@/validators/lpcAsset";

type PackedSheet = Omit<LpcSheet, "image" | "depth" | "travel" | "offhand"> & {
  image: number;
  depth?: number;
  travel?: number;
  offhand?: number;
};

/** Shared tables keep complete character libraries below function response limits. */
export type PackedLpcCatalog = Omit<LpcCatalog, "entries" | "palettes"> & {
  version: 1;
  entries: Record<string, number[]>;
  palettes: {
    channel: "skin" | "hair" | "eyes";
    images: Record<string, number>;
    intensityTints?: NonNullable<LpcAssetSheet["palette"]>["intensityTints"];
  }[];
  images: string[];
  sheets: PackedSheet[];
};

/** Intern repeated image URLs and atlas descriptions without changing authored poses. */
export const packLpcCatalog = (catalog: LpcCatalog): PackedLpcCatalog => {
  const images: string[] = [];
  const sheets: PackedSheet[] = [];
  const imageIds = new Map<string, number>();
  const sheetIds = new Map<string, number>();
  const image = (url: string) => {
    let index = imageIds.get(url);
    if (index === undefined) {
      index = images.length;
      imageIds.set(url, index);
      images.push(url);
    }
    return index;
  };
  const sheet = (source: LpcSheet): number => {
    const { image: url, depth, travel, offhand, ...metadata } = source;
    const packed: PackedSheet = {
      ...metadata,
      image: image(url),
      ...(depth ? { depth: image(depth) } : {}),
      ...(offhand ? { offhand: sheet(offhand) } : {}),
      ...(travel ? { travel: sheet(travel) } : {}),
    };
    const key = JSON.stringify(packed);
    let index = sheetIds.get(key);
    if (index === undefined) {
      index = sheets.length;
      sheetIds.set(key, index);
      sheets.push(packed);
    }
    return index;
  };
  return {
    version: 1,
    entries: Object.fromEntries(
      Object.entries(catalog.entries).map(([key, parts]) => [key, parts.map(sheet)]),
    ),
    layouts: catalog.layouts,
    designs: catalog.designs,
    palettes: (catalog.palettes ?? []).map((palette) => ({
      channel: palette.channel,
      ...(palette.intensityTints ? { intensityTints: palette.intensityTints } : {}),
      images: Object.fromEntries(
        Object.entries(palette.images).map(([color, url]) => [color, image(url)]),
      ),
    })),
    images,
    sheets,
  };
};

const decodedCatalogs = new WeakMap<PackedLpcCatalog, LpcCatalog>();

/** Restore one immutable network snapshot; repeated scene reads share its decoded tables. */
export const unpackLpcCatalog = (packed: PackedLpcCatalog): LpcCatalog => {
  const cached = decodedCatalogs.get(packed);
  if (cached) return cached;
  if (packed.version !== 1) throw new Error("Unsupported character catalog format");
  const images = (index: number) => {
    const url = packed.images[index];
    if (url === undefined) throw new Error("Missing character image reference");
    return url;
  };
  const sheets: LpcSheet[] = [];
  const sheet = (index: number) => {
    const value = sheets[index];
    if (!value) throw new Error("Missing character atlas reference");
    return value;
  };
  for (const source of packed.sheets) {
    const { image, depth, travel, offhand, ...metadata } = source;
    if (!packed.layouts[metadata.layout])
      throw new Error("Missing character layout reference");
    sheets.push({
      ...metadata,
      image: images(image),
      ...(depth !== undefined ? { depth: images(depth) } : {}),
      ...(offhand !== undefined ? { offhand: sheet(offhand) } : {}),
      ...(travel !== undefined ? { travel: sheet(travel) } : {}),
    });
  }
  const catalog: LpcCatalog = {
    entries: Object.fromEntries(
      Object.entries(packed.entries).map(([key, parts]) => [key, parts.map(sheet)]),
    ),
    layouts: packed.layouts,
    designs: packed.designs,
    palettes: packed.palettes.map((palette) => ({
      channel: palette.channel,
      ...(palette.intensityTints ? { intensityTints: palette.intensityTints } : {}),
      images: Object.fromEntries(
        Object.entries(palette.images).map(([color, index]) => [color, images(index)]),
      ),
    })),
  };
  decodedCatalogs.set(packed, catalog);
  return catalog;
};

/** Pack editor definitions through the same atlas tables as scene delivery. */
export const packLpcDesigns = <T extends { id: string; lpcConfig: LpcConfig | null }>(
  assets: T[],
) => ({
  assets: assets.map(({ lpcConfig, ...asset }) => {
    if (!lpcConfig) return { ...asset, lpcConfig: null };
    const { variants: _variants, ...metadata } = lpcConfig;
    return { ...asset, lpcConfig: metadata };
  }),
  catalog: packLpcCatalog(buildLpcCatalog(assets)),
});

/** Reconstruct editable settings, retaining drafts and all non-artwork row metadata. */
export const unpackLpcDesigns = <
  T extends { id: string; lpcConfig: Omit<LpcConfig, "variants"> | null },
>(packed: {
  assets: T[];
  catalog: PackedLpcCatalog;
}) => {
  const catalog = unpackLpcCatalog(packed.catalog);
  return packed.assets.map(({ lpcConfig, ...asset }) => ({
    ...asset,
    lpcConfig: lpcConfig
      ? {
          ...lpcConfig,
          variants: expandLpcDesignVariants(catalog, asset.id),
        }
      : null,
  }));
};
