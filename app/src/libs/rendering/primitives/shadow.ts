import { BufferImageSource, Texture } from "pixi.js";
import { createLeaseCache } from "@/libs/rendering/leaseCache";

/** A tiny palette-stepped light pool gives lanterns a pixel edge without a blur pass. */
export const createPixelLightTexture = () => {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
      const falloff = Math.max(0, 1 - distance);
      const alpha = Math.floor(falloff * falloff * 24) / 24;
      const index = (y * size + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
      pixels[index + 3] = Math.round(alpha * 255);
    }
  return new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: size,
      height: size,
      format: "rgba8unorm",
      scaleMode: "nearest",
    }),
  });
};

/** Creates a soft ellipse to share within a scene; its owner must destroy the texture/source. */
export const createSoftShadowTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.scale(2, 1);
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(0,0,0,.45)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return Texture.from(canvas, true);
};

let contactTexture: Texture | null = null;
const contacts = createLeaseCache<Texture>({
  load: async () => {
    contactTexture = createSoftShadowTexture();
    return contactTexture;
  },
  unload: async () => {
    contactTexture?.destroy(true);
    contactTexture = null;
  },
  bytes: (texture) => texture.width * texture.height * 4,
  idleBudget: 0,
});

/** Actors and scenery lease one contact mask; the final release destroys its texture and source. */
export const acquireSoftShadowTexture = () => contacts.acquire("contact");
