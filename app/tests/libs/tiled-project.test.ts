import { describe, expect, it } from "vitest";
import { DECORATION_ASSETS } from "@/libs/sector-map/decorations";
import { buildTiledProject } from "@/libs/sector-map/tiled-project";
import { SECTOR_MAP_OBJECT_TYPES } from "@/libs/sector-map/types";

describe("tiled project kit", () => {
  const project = buildTiledProject(DECORATION_ASSETS) as {
    propertyTypes: Array<{
      name: string;
      type: string;
      values?: string[];
      useAs?: string[];
      members?: Array<{ name: string; propertyType?: string }>;
    }>;
  };
  const byName = (name: string) =>
    project.propertyTypes.find((entry) => entry.name === name);

  it("exposes every decoration key as an AssetKey enum", () => {
    const assetKey = byName("AssetKey");
    expect(assetKey?.type).toBe("enum");
    expect(assetKey?.values).toEqual(DECORATION_ASSETS.map((asset) => asset.key));
  });

  it("defines a decoration object class whose assetKey uses the enum", () => {
    const decoration = byName("decoration");
    expect(decoration?.type).toBe("class");
    expect(decoration?.useAs).toContain("object");
    const member = decoration?.members?.find((entry) => entry.name === "assetKey");
    expect(member?.propertyType).toBe("AssetKey");
  });

  it("defines exit objects with the routing members the importer reads", () => {
    const names = byName("exit")?.members?.map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining(["targetSector", "targetAnchor", "travelCost"]),
    );
  });

  it("defines a class for every importer object type", () => {
    // Derived from the importer's canonical list, so a new object type added to
    // production fails here until the Tiled kit ships a class for it
    for (const type of SECTOR_MAP_OBJECT_TYPES) {
      expect(byName(type)?.type).toBe("class");
    }
  });
});
