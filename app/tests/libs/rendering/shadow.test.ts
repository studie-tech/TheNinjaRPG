import { describe, expect, it } from "bun:test";
import { createPixelLightTexture } from "@/libs/rendering/primitives/shadow";

describe("ground-light textures", () => {
  it("keeps the palette-stepped sampler as the default", () => {
    const texture = createPixelLightTexture();
    try {
      expect(texture.source.scaleMode).toBe("nearest");
    } finally {
      texture.destroy(true);
    }
  });
});
