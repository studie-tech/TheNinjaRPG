import { characterFrameOffset } from "@/libs/rendering/characterFrame";

/** Compose native character pixels by camera depth, retaining transparent details above the nearest opaque surface. */
export const composeCharacterPixels = (
  layers: CharacterDepthLayer[],
  size: number,
  pixelsPerUnit: number,
) => {
  const output = new Uint8Array(size * size * 4);
  let left = size,
    top = size,
    right = 0,
    bottom = 0;
  const mapped = layers.map((layer) => {
    if (
      layer.pixels.length !== layer.width * layer.height * 4 ||
      layer.depth.length !== layer.pixels.length
    )
      throw new Error("Character colour and depth dimensions must match");
    const { frame } = layer;
    const origin = characterFrameOffset(frame, layer.pixelsPerUnit, layer.mirror);
    const columns = new Int32Array(size).fill(-1);
    const rows = new Int32Array(size).fill(-1);
    for (let index = 0; index < size; index++) {
      const local = ((index + 0.5 - size / 2) * layer.pixelsPerUnit) / pixelsPerUnit;
      const localX = local - origin.x * layer.pixelsPerUnit;
      const x = Math.floor(frame.size / 2 + (layer.mirror ? -localX : localX));
      const y = Math.floor(frame.size / 2 + local - origin.y * layer.pixelsPerUnit);
      const sourceX = x - (frame.trim?.x ?? 0);
      const sourceY = y - (frame.trim?.y ?? 0);
      if (sourceX >= 0 && sourceX < frame.width) {
        columns[index] = Math.floor(frame.x) + sourceX;
        left = Math.min(left, index);
        right = Math.max(right, index + 1);
      }
      if (sourceY >= 0 && sourceY < frame.height) {
        rows[index] = (Math.floor(frame.y) + sourceY) * layer.width;
        top = Math.min(top, index);
        bottom = Math.max(bottom, index + 1);
      }
    }
    return { ...layer, columns, rows };
  });
  const transparent: { depth: number; z: number; index: number; layer: number }[] = [];
  // Overscan protects weapon swings; pixels outside every source crop stay transparent.
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      let closest = Number.POSITIVE_INFINITY;
      let frontZ = Number.NEGATIVE_INFINITY;
      let opaqueLayer = -1;
      let opaqueIndex = 0;
      transparent.length = 0;
      for (let layerIndex = 0; layerIndex < mapped.length; layerIndex++) {
        const layer = mapped[layerIndex]!;
        const column = layer.columns[x]!,
          row = layer.rows[y]!;
        if (column < 0 || row < 0) continue;
        const index = (row + column) * 4;
        const alpha = layer.pixels[index + 3] ?? 0;
        if (!alpha) continue;
        const packed =
          ((layer.depth[index] ?? 0) << 16) |
          ((layer.depth[index + 1] ?? 0) << 8) |
          (layer.depth[index + 2] ?? 0);
        if (!packed || layer.bodyRegions?.has(packed & 15)) continue;
        const depth = layer.bodyRegions ? packed & ~15 : packed;
        if (!depth) continue;
        if (alpha < 255) {
          transparent.push({ depth, z: layer.z, index, layer: layerIndex });
        } else if (depth < closest || (depth === closest && layer.z >= frontZ)) {
          closest = depth;
          frontZ = layer.z;
          opaqueLayer = layerIndex;
          opaqueIndex = index;
        }
      }
      const offset = (y * size + x) * 4;
      if (opaqueLayer >= 0) {
        const layer = mapped[opaqueLayer]!;
        output.set(layer.pixels.subarray(opaqueIndex, opaqueIndex + 4), offset);
        if (layer.intensityTint) {
          const intensity =
            (((layer.pixels[opaqueIndex]! << 8) | layer.pixels[opaqueIndex + 1]!) * 2) /
            65535;
          for (let channel = 0; channel < 3; channel++)
            output[offset + channel] = linearByte(
              intensity * layer.intensityTint[channel]!,
            );
        }
      }
      if (!transparent.length) continue;
      transparent.sort((a, b) => b.depth - a.depth || a.z - b.z);
      for (const surface of transparent) {
        if (
          surface.depth > closest ||
          (surface.depth === closest && surface.z < frontZ)
        )
          continue;
        const layer = mapped[surface.layer]!;
        const source = layer.pixels;
        const intensity = layer.intensityTint
          ? (((source[surface.index]! << 8) | source[surface.index + 1]!) * 2) / 65535
          : 0;
        const alpha = source[surface.index + 3]! / 255;
        const previous = output[offset + 3]! / 255;
        const combined = alpha + previous * (1 - alpha);
        for (let channel = 0; channel < 3; channel++)
          output[offset + channel] = Math.round(
            ((layer.intensityTint
              ? linearByte(intensity * layer.intensityTint[channel]!)
              : source[surface.index + channel]!) *
              alpha +
              output[offset + channel]! * previous * (1 - alpha)) /
              combined,
          );
        output[offset + 3] = Math.round(combined * 255);
      }
    }
  }
  return output;
};

const linearByte = (value: number) =>
  Math.round(
    Math.min(
      1,
      Math.max(
        0,
        value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055,
      ),
    ) * 255,
  );

/** Opaque RGB depth stores micrometres from the shared orthographic camera; RGB zero is empty. */
export type CharacterDepthLayer = {
  pixels: Uint8Array;
  intensityTint?: [number, number, number];
  depth: Uint8Array;
  width: number;
  height: number;
  pixelsPerUnit: number;
  mirror: boolean;
  z: number;
  /** Presence reserves the low four depth bits for regions; listed sections are replaced by another garment. */
  bodyRegions?: ReadonlySet<number>;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    size: number;
    trim?: { x: number; y: number };
    ground?: { x: number; y: number };
  };
};
