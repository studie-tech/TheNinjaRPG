import { describe, expect, it } from "bun:test";
import { calculateContentDiff, parseContentChange } from "@/utils/diff";

describe("parseContentChange", () => {
  it("lists each updated field path with its new value", () => {
    const [change] = calculateContentDiff(
      { name: "Fire", effects: [{ power: 10, type: "damage" }] },
      { name: "Fire", effects: [{ power: 30, type: "damage" }] },
    );
    expect(parseContentChange(change ?? "")).toEqual({
      kind: "Updated",
      fields: [{ path: "effects.0.power", value: "30" }],
    });
  });

  it("marks deleted fields without a value", () => {
    const changes = calculateContentDiff({ a: 1, tags: ["x", "y"] }, { tags: ["x"] });
    const parsed = changes.map(parseContentChange);
    expect(parsed).toEqual([
      { kind: "Deleted", fields: [{ path: "tags", value: undefined }] },
    ]);
  });

  it("keeps string values unquoted and nested objects as JSON leaves", () => {
    const [change] = calculateContentDiff({}, { description: "Hot", extra: {} });
    expect(parseContentChange(change ?? "")).toEqual({
      kind: "Added",
      fields: [
        { path: "description", value: "Hot" },
        { path: "extra", value: "{}" },
      ],
    });
  });

  it("returns null for free-form log text and malformed JSON", () => {
    expect(parseContentChange("Jutsu created")).toBeNull();
    expect(parseContentChange("Updated: {not json")).toBeNull();
    expect(parseContentChange('Updated: "text"')).toBeNull();
  });
});
