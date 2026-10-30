/** Picking follows the full display hierarchy, including hidden actor and sector wrappers. */
export const isObjectChainVisible = (object: VisibleObject | null): boolean => {
  for (let current = object; current; current = current.parent)
    if (!current.visible) return false;
  return object !== null;
};

/** Bounds in upward-growing map coordinates, including artwork rotation and its anchor. */
export const worldSpriteBounds = (sprite: {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  rotation: number;
  shearY?: number;
}): WorldBounds => {
  const cosine = Math.cos(sprite.rotation),
    sine = Math.sin(sprite.rotation);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const x of [
    -sprite.anchorX * sprite.width,
    (1 - sprite.anchorX) * sprite.width,
  ]) {
    for (const y of [
      (sprite.anchorY - 1) * sprite.height,
      sprite.anchorY * sprite.height,
    ]) {
      const shearedY = y + x * (sprite.shearY ?? 0);
      const px = sprite.x + x * cosine - shearedY * sine;
      const py = sprite.y + x * sine + shearedY * cosine;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }
  return { minX, minY, maxX, maxY };
};

export const boundsOverlap = (a: WorldBounds, b: WorldBounds, padding = 0) =>
  a.maxX + padding >= b.minX &&
  a.minX - padding <= b.maxX &&
  a.maxY + padding >= b.minY &&
  a.minY - padding <= b.maxY;

type VisibleObject = { visible: boolean; parent: VisibleObject | null };
export type WorldBounds = { minX: number; minY: number; maxX: number; maxY: number };
