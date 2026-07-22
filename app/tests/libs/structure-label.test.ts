import { describe, expect, it } from "vitest";
import { wrapStructureLabelWords } from "@/libs/threejs/sector";

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
