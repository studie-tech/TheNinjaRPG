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

let lightTexture: Texture | null = null;
const lights = createLeaseCache<Texture>({
  load: async () => {
    lightTexture = createPixelLightTexture();
    return lightTexture;
  },
  unload: async () => {
    lightTexture?.destroy(true);
    lightTexture = null;
  },
  bytes: (texture) => texture.width * texture.height * 4,
  idleBudget: 0,
});

/** Lamps and actors share one light pool texture, so their additive pools batch together. */
export const acquirePixelLightTexture = () => lights.acquire("light");

/** Ellipse proportions of the ring under a walking character, relative to its width. */
export const CONTACT_RING = {
  width: 128,
  height: 48,
  radiusX: 60,
  radiusY: 20.57,
  stroke: 3.67,
};

/**
 * A dark contact ellipse with a white rim; the actor tints it with its alliance colour, which
 * leaves the near-black fill unchanged.
 */
export const createContactRingTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = CONTACT_RING.width;
  canvas.height = CONTACT_RING.height;
  const context = canvas.getContext("2d");
  if (context) {
    const { width, height, radiusX, radiusY, stroke } = CONTACT_RING;
    context.beginPath();
    context.ellipse(width / 2, height / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = "rgba(8,17,21,0.4)";
    context.fill();
    context.lineWidth = stroke;
    context.strokeStyle = "rgba(255,255,255,0.45)";
    context.stroke();
  }
  return Texture.from(canvas, true);
};

let ring: { texture: Texture; users: number } | null = null;

/**
 * Every character's contact ring is one quad from this shared texture. Actors place their ring
 * the moment they appear, so the lease is synchronous; the last release destroys it.
 */
export const acquireContactRingTexture = () => {
  ring ??= { texture: createContactRingTexture(), users: 0 };
  const lease = ring;
  lease.users++;
  let released = false;
  return {
    texture: lease.texture,
    release: () => {
      if (released) return;
      released = true;
      if (--lease.users > 0) return;
      if (ring === lease) ring = null;
      lease.texture.destroy(true);
    },
  };
};
