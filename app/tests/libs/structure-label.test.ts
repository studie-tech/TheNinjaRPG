import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import {
  getStructureLabelScale,
  sortSectorAssetsByGroundContact,
  wrapStructureLabelCharacters,
  wrapStructureLabelWords,
} from "@/libs/threejs/sector";

const measureText = (text: string) => text.length * 10;

describe("wrapStructureLabelWords", () => {
  it("keeps a short label on one line", () => {
    expect(wrapStructureLabelWords("Town Hall", measureText, 120)).toEqual([
      "Town Hall",
    ]);
  });

  it("wraps a long label at word boundaries", () => {
    expect(
      wrapStructureLabelWords("Administration Building", measureText, 150),
    ).toEqual(["Administration", "Building"]);
  });

  it("packs as many complete words as fit on each line", () => {
    expect(
      wrapStructureLabelWords("Center Science Building", measureText, 140),
    ).toEqual(["Center Science", "Building"]);
  });
});

describe("wrapStructureLabelCharacters", () => {
  it("keeps every fallback line within the available width", () => {
    expect(wrapStructureLabelCharacters("ABCDEFGHIJK", measureText, 50)).toEqual([
      "ABCDE",
      "FGHIJ",
      "K",
    ]);
  });
});

describe("getStructureLabelScale", () => {
  it("preserves the authored size at the desktop reference zoom", () => {
    expect(getStructureLabelScale(1200, 2)).toBe(1);
  });

  it("makes labels more compact on narrow layouts", () => {
    expect(getStructureLabelScale(720, 2)).toBeCloseTo(0.72);
  });

  it("caps zoom compensation so distant labels do not dominate the map", () => {
    expect(getStructureLabelScale(1200, 0.5)).toBe(1.6);
  });
});

describe("sortSectorAssetsByGroundContact", () => {
  it("draws structure labels after every scenery asset", () => {
    const group = new Group();
    const label = new Object3D();
    label.name = "label";
    label.userData.type = "structureLabel";
    label.position.y = 200;

    const farTree = new Object3D();
    farTree.name = "far-tree";
    farTree.userData.type = "decoration";
    farTree.userData.assetSortY = 150;

    const nearBuilding = new Object3D();
    nearBuilding.name = "near-building";
    nearBuilding.userData.type = "structure";
    nearBuilding.userData.assetSortY = 50;

    group.add(label, nearBuilding, farTree);
    sortSectorAssetsByGroundContact(group);

    expect(group.children.map((child) => child.name)).toEqual([
      "far-tree",
      "near-building",
      "label",
    ]);
  });
});
