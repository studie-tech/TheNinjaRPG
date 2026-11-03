import { describe, expect, it } from "bun:test";
import { createPixelLightTexture } from "@/libs/rendering/primitives/shadow";

describe("ground-light textures", () => {
  it("keeps the palette-stepped sampler as the default", () => {
    const texture = createPixelLightTexture();
    try { expect(texture.source.scaleMode).toBe("nearest"); }
    finally { texture.destroy(true); }
  });

  it("uses premultiplied translucent texels for smooth additive pools without a blur pass", () => {
    const texture = createPixelLightTexture({ smooth: true });
    try {
      expect(texture.source.scaleMode).toBe("linear");
      expect(texture.source.alphaMode).toBe("premultiplied-alpha");
      const pixels = texture.source.resource;
      if (!(pixels instanceof Uint8Array)) throw Error("Expected a baked RGBA texture");
      let hasTranslucentPixel = false, isPremultiplied = true;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3] ?? 0;
        if (alpha > 0 && alpha < 255) hasTranslucentPixel = true;
        if ((pixels[i] ?? 0) > alpha || (pixels[i + 1] ?? 0) > alpha || (pixels[i + 2] ?? 0) > alpha) isPremultiplied = false;
      }
      expect(hasTranslucentPixel).toBe(true); expect(isPremultiplied).toBe(true);
    } finally { texture.destroy(true); }
  });
});
