import type { LpcAssetSheet, LpcConfig, LpcLayout } from "@/validators/lpcAsset";

/** Enumerate immutable design files for validation and export, including palettes and handed poses. */
export const lpcAtlasResources = (config?: LpcConfig | null) => {
  const resources = new Map<
    string,
    { image: string; layout: LpcLayout; numerical: boolean }
  >();
  const add = (image: string, layout: LpcLayout, numerical = false) => {
    resources.set(JSON.stringify([image, layout, numerical]), {
      image,
      layout,
      numerical,
    });
  };
  const visit = (
    atlas: Pick<LpcAssetSheet, "image" | "depth" | "palette" | "layout" | "offhand">,
  ) => {
    add(atlas.image, atlas.layout);
    if (atlas.depth) add(atlas.depth, atlas.layout, true);
    for (const image of Object.values(atlas.palette?.images ?? {}))
      add(image, atlas.layout);
    if (atlas.offhand) visit(atlas.offhand);
  };
  for (const sheet of Object.values(config?.variants ?? {}).flat()) {
    visit(sheet);
    if (sheet.travel) visit(sheet.travel);
  }
  return [...resources.values()];
};
