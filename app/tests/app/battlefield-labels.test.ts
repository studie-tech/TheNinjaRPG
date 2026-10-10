
import { describe, expect, it } from "bun:test";
import { prepareBattlefieldLabels } from "../../../.github/scripts/battlefield-labels.mjs";
import { battlefieldSheetsSchema } from "@/validators/contentReview";

describe("content audit battlefield labels", () => {
  it("renders multi-effect candidates while preserving their full asset mapping in the index", () => {
    const candidate = `suggested, candidate 1: ${[
      "appearAnimation",
      "staticAnimation",
      "disappearAnimation",
    ]
      .map(
        (field) =>
          `effects.0.${field} = ${"Water animation ".repeat(5)} (asset-${field})`,
      )
      .join(", ")}`;
    const original = [
      {
        title: `Suggestion 2: ${"Improve battlefield animation ".repeat(10)}`,
        entityType: "JUTSU",
        entityId: "j1",
        variants: [
          { name: "current", fields: { effects: [] } },
          {
            name: candidate,
            fields: { effects: [{ appearAnimation: "asset-appearAnimation" }] },
          },
        ],
      },
    ];
    const input = { requests: original, perSheet: 1, background: "ground" };
    expect(battlefieldSheetsSchema.safeParse(input).success).toBe(false);

    const prepared = prepareBattlefieldLabels(original);
    expect(
      battlefieldSheetsSchema.safeParse({ ...input, requests: prepared.requests })
        .success,
    ).toBe(true);
    expect(prepared.requests[0].title).toHaveLength(200);
    expect(prepared.requests[0].variants[1].name).toHaveLength(160);
    expect(prepared.requests[0].variants[1].fields).toEqual(
      original[0]?.variants[1]?.fields,
    );
    expect(prepared.blocks[0].description).toBe(original[0]?.title);
    expect(prepared.blocks[0].variants[1].description).toBe(candidate);
    expect(original[0]?.variants[1]?.name).toBe(candidate);
  });

  it("keeps captions at the schema limits unchanged and handles gallery titles", () => {
    const original = [
      {
        title: "a".repeat(200),
        entityType: "GAME_ASSET",
        entityId: "asset1",
        variants: [{ name: "b".repeat(160), fields: { type: "ANIMATION" } }],
      },
    ];
    expect(prepareBattlefieldLabels(original).requests).toEqual(original);
    const gallery = [
      {
        ...original[0],
        title: `${"Long asset name ".repeat(20)} · asset1 · animation, used by 10 effects`,
      },
    ];
    const prepared = prepareBattlefieldLabels(gallery);
    expect(
      battlefieldSheetsSchema.safeParse({ requests: prepared.requests, perSheet: 2 })
        .success,
    ).toBe(true);
    expect(prepared.blocks[0].description).toBe(gallery[0]?.title);
  });
});
