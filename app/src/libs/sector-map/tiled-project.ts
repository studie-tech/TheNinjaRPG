import type { DecorationAsset } from "@/libs/sector-map/decorations";

/**
 * A Tiled project (.tiled-project) that gives the content team validated,
 * dropdown-driven object editing in the Tiled map editor. It defines:
 *   - an `AssetKey` enum (every decoration key, generated from the registry so
 *     it never drifts) shown as a dropdown on decoration objects, and
 *   - object classes (decoration / anchor / exit / structure / shrine /
 *     landmark) whose members mirror exactly what normalizeTiledSectorMap reads.
 *
 * Placed in a sector's download .zip so opening the project makes every sector
 * in that folder editable without hand-typing property names or asset keys.
 */

interface TiledMember {
  name: string;
  type: "string" | "int" | "float" | "bool";
  value: string | number | boolean;
  propertyType?: string;
}

// gridX/gridY pin the exact hex cell an object sits on (authoritative for the
// importer). Fresh array per class so there is no shared-reference aliasing.
const gridMembers = (): TiledMember[] => [
  { name: "gridX", type: "int", value: 0 },
  { name: "gridY", type: "int", value: 0 },
];

/** One Tiled propertyTypes "class" entry: an object class with editor color and filled drawing */
const objectClass = (
  id: number,
  name: string,
  color: string,
  members: TiledMember[],
) => ({
  id,
  name,
  type: "class" as const,
  color,
  drawFill: true,
  useAs: ["object"],
  members,
});

/**
 * Assemble the .tiled-project JSON (see the module docblock). The AssetKey
 * enum is generated from the passed decoration registry, so the editor's
 * dropdown never drifts from the actually placeable assets.
 */
export const buildTiledProject = (assets: DecorationAsset[]) => ({
  automappingRulesFile: "",
  commands: [],
  compatibilityVersion: 1100,
  extensionsPath: "extensions",
  folders: ["."],
  properties: [],
  propertyTypes: [
    {
      id: 1,
      name: "AssetKey",
      type: "enum" as const,
      storageType: "string" as const,
      values: assets.map((asset) => asset.key),
      valuesAsFlags: false,
    },
    objectClass(2, "decoration", "#4caf50", [
      { name: "assetKey", type: "string", value: "", propertyType: "AssetKey" },
      { name: "scale", type: "float", value: 1 },
      { name: "offsetX", type: "float", value: 0 },
      ...gridMembers(),
    ]),
    // anchor / structure / shrine keys come from the object's NAME
    objectClass(3, "anchor", "#2196f3", gridMembers()),
    objectClass(4, "structure", "#9c27b0", gridMembers()),
    objectClass(5, "shrine", "#e91e63", gridMembers()),
    objectClass(6, "exit", "#ff9800", [
      { name: "targetSector", type: "int", value: 0 },
      { name: "targetAnchor", type: "string", value: "spawn.default" },
      { name: "travelCost", type: "float", value: 1 },
      ...gridMembers(),
    ]),
    objectClass(7, "landmark", "#795548", [
      { name: "route", type: "string", value: "" },
      ...gridMembers(),
    ]),
  ],
});

/** Plain-text guide bundled in every sector download so editors know the flow */
export const TILED_KIT_README = `TheNinja-RPG - editing a sector map in Tiled
================================================

This .zip contains everything to edit one sector in the Tiled editor
(free, https://www.mapeditor.org):

  sector-<n>.json           the sector map - open this in Tiled
  terrain.png               terrain colours for the map's tileset
  decorations/              the decoration sprites (trees, rocks, ...)
  tnr-sectors.tiled-project object classes + the decoration dropdown

FIRST-TIME SETUP (once)
  1. Install Tiled: https://www.mapeditor.org
  2. Tiled menu: Project > Open Project... > tnr-sectors.tiled-project

EDIT A SECTOR
  1. File > Open... > sector-<n>.json  (keep everything together as unzipped)
  2. Terrain layer: paint with the palette on the right. Each colour is a biome
     (green = grass/ground, tan = sand/desert, blue = ocean, white = ice,
     dark = blocked rock, brown = road). The palette always contains EVERY
     terrain kind - you can paint water, ice or desert into any sector, not
     just the terrains the sector already has.
  3. Objects layer (trees, rocks, spawns, exits, ...):
     - DECORATIONS show as their actual sprites. To add one, just drag it from
       the "decorations" tileset onto the map - it carries its class and
       assetKey automatically. Optional properties: scale, offsetX.
     - ANCHOR / STRUCTURE / SHRINE: the object's NAME is its key
       (e.g. spawn.default, structure.hospital, shrine.default).
     - EXIT: name it with its key (e.g. exit.north) and set targetSector,
       targetAnchor and travelCost.
     - THE GAME reads each object's hex cell from its gridX / gridY property
       when set; objects placed by hand without it (e.g. dragged decorations)
       are snapped to the hex under their position on import.

PUBLISH
  1. Save the .json in Tiled (File > Save).
  2. In the game: Manual > Travel > Sector Maps.
  3. Upload the .json, click Validate, then Save Draft or Publish.

The terrain colours are only an editing aid - the game renders its own art.
`;
