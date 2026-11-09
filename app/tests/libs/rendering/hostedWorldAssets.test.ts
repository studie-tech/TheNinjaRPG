import { expect, it } from "bun:test";
import lightFields from "@/libs/rendering/bakedVillageLightFields.json";
import bakedSources from "@/libs/rendering/bakedWorldSources.json";
import worldSources from "@/libs/rendering/worldAssetSources.json";
import surfaceFrames from "@/libs/rendering/worldSurfaceFrames.json";
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
    ...Object.values(surfaceFrames).flatMap((frames) =>
      frames.map((frame) => frame.url),
    ),
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

it("splits every published atlas's surfaces into one copy per published frame", () => {
  expect(Object.keys(surfaceFrames).sort()).toEqual(
    Object.values(worldSources)
      .map((source) => source.surfaces)
      .sort(),
  );
  for (const source of Object.values(worldSources)) {
    const frames = surfaceFrames[source.surfaces as keyof typeof surfaceFrames];
    expect(frames.map((entry) => entry.frame)).toEqual(source.frames);
    expect(new Set(frames.map((entry) => entry.url)).size).toBe(frames.length);
    for (const entry of frames) expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  }
});
