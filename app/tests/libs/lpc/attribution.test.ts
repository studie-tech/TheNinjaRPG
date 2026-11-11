import { describe, expect, it } from "bun:test";
import { groupLpcCreditsByArtist } from "@/libs/lpc/attribution";
import type { LpcAttribution } from "@/validators/lpcAsset";

const credit = (authors: string[], urls: string[] = []): LpcAttribution => ({
  authors,
  licenses: ["CC-BY-SA 3.0"],
  chosenLicense: "CC-BY-SA 3.0",
  urls,
  notes: "",
});

describe("artwork credits grouping", () => {
  it("lists each set of authors once with every asset that uses their work", () => {
    const groups = groupLpcCreditsByArtist([
      {
        name: "Shirt",
        lpcConfig: { attributions: [credit(["Zed"]), credit(["Amy"])] },
      },
      { name: "Pants", lpcConfig: { attributions: [credit(["Zed"])] } },
      { name: "Hair", lpcConfig: null },
    ]);
    expect(groups.map((group) => group.authors)).toEqual([["Amy"], ["Zed"]]);
    expect(groups[1]!.assets.map((asset) => asset.profile)).toEqual(["Shirt", "Pants"]);
  });

  it("keeps every source link but shows a repeated URL once", () => {
    const [group] = groupLpcCreditsByArtist([
      {
        name: "Cape",
        lpcConfig: {
          attributions: [
            credit(
              ["Amy"],
              ["https://a.example/1", "https://a.example/1", "https://b.example"],
            ),
          ],
        },
      },
    ]);
    expect(group!.assets[0]!.urls).toEqual([
      "https://a.example/1",
      "https://b.example",
    ]);
  });
});
