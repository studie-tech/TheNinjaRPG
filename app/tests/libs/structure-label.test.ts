import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { sortSectorAssetsByGroundContact } from "@/libs/threejs/sector";

describe("sortSectorAssetsByGroundContact", () => {
  it("sorts scenery by ground contact back-to-front", () => {
    const group = new Group();
    const farTree = new Object3D();
    farTree.name = "far-tree";
    farTree.userData.type = "decoration";
    farTree.userData.assetSortY = 150;

    const nearBuilding = new Object3D();
    nearBuilding.name = "near-building";
    nearBuilding.userData.type = "structure";
    nearBuilding.userData.assetSortY = 50;

    group.add(nearBuilding, farTree);
    sortSectorAssetsByGroundContact(group);

    expect(group.children.map((child) => child.name)).toEqual([
      "far-tree",
      "near-building",
    ]);
  });
});
