import type { LpcAnimation } from "@/validators/lpc";

/** Locate a frame in a shared grid or a tightly cropped animation region. */
export const lpcAtlasFrame = (
  layout: AtlasGrid,
  animation: LpcAnimation,
  index: number,
) => {
  const region = layout.regions?.[animation];
  const trim = region?.trim ?? layout.trim;
  const width = trim?.width ?? layout.cell,
    height = trim?.height ?? layout.cell;
  const gutter = trim ? 1 : 0,
    columns = region?.columns ?? layout.columns;
  return {
    x: (region?.x ?? 0) + (index % columns) * (width + gutter * 2) + gutter,
    y: (region?.y ?? 0) + Math.floor(index / columns) * (height + gutter * 2) + gutter,
    size: layout.cell,
    width,
    height,
    trim,
    ...(layout.pixelsPerUnit ? { pixelsPerUnit: layout.pixelsPerUnit } : {}),
    ...(layout.ground ? { ground: layout.ground } : {}),
  };
};

type Crop = { x: number; y: number; width: number; height: number };
type AtlasGrid = {
  cell: number;
  columns: number;
  trim?: Crop;
  pixelsPerUnit?: number;
  ground?: { x: number; y: number };
  regions?: Partial<
    Record<LpcAnimation, { x: number; y: number; columns: number; trim: Crop }>
  >;
};
