import { expect, it } from "bun:test";
import { buildLpcCatalog, type LpcCatalog } from "@/libs/lpc/catalog";
import { LPC_CONFIG_MAX_BYTES } from "@/validators/lpcAsset";
import source from "../../drizzle/data/lpc/catalog.json";
import { lpcSeedAssets } from "../../drizzle/data/lpc/seed";

it("round-trips every published profile without losing atlas, palette or hand metadata", () => {
  const assets = lpcSeedAssets();
  const { entries, layouts, palettes, designs } = source as unknown as LpcCatalog;
  expect(assets.map((asset) => asset.id).sort()).toEqual(
    Object.keys(source.profiles).sort(),
  );
  expect(buildLpcCatalog(assets)).toEqual({ entries, layouts, palettes, designs });
  for (const asset of assets) {
    expect(asset.lpcConfig.sourceRevision).toBe(source.revision);
    expect(asset.url).toBe(source.creditsUrl);
    expect(Buffer.byteLength(JSON.stringify(asset.lpcConfig))).toBeLessThanOrEqual(
      LPC_CONFIG_MAX_BYTES,
    );
  }
});
