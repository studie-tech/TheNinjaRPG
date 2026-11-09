import { expect, it } from "bun:test";
import lightFields from "@/libs/rendering/bakedVillageLightFields.json";
import bakedSources from "@/libs/rendering/bakedWorldSources.json";
import worldSources from "@/libs/rendering/worldAssetSources.json";
import { isBunnyCdnUrl, textureImageUrl } from "@/utils/image";

it("serves published world textures through Bunny without modifying packed pixels", () => {
  const images = [
    ...Object.values(bakedSources).flatMap((source) => [
      source.atlas,
      ...("emission" in source ? [source.emission] : []),
    ]),
    ...Object.values(lightFields.fields).map((field) => field.image),
    ...Object.values(worldSources).flatMap((source) => [
      source.image,
      source.material,
      source.surfaces,
    ]),
  ];
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) {
    const delivery = textureImageUrl(image, 0);
    const url = new URL(delivery);
    expect(isBunnyCdnUrl(delivery)).toBe(true);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toMatch(/^\/f\/[a-zA-Z0-9_-]+$/);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  }
});
