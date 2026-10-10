
import { describe, expect, it } from "bun:test";
import { flattenLeaves, wordDiff } from "@/utils/wordDiff";

describe("wordDiff", () => {
  it("marks replaced words as one removed and one added phrase", () => {
    expect(wordDiff("traps there opponent", "traps their opponent")).toEqual([
      { op: "same", text: "traps " },
      { op: "removed", text: "there" },
      { op: "added", text: "their" },
      { op: "same", text: " opponent" },
    ]);
  });

  it("keeps combat placeholders as whole tokens", () => {
    const parts = wordDiff("%user trap %target", "%user traps %target.");
    expect(parts[0]).toEqual({ op: "same", text: "%user " });
    expect(parts.filter((part) => part.op !== "same").map((part) => part.text)).toEqual([
      "trap",
      "traps",
      ".",
    ]);
  });

  it("returns the text unchanged when nothing differs", () => {
    expect(wordDiff("same text", "same text")).toEqual([{ op: "same", text: "same text" }]);
  });
});

describe("flattenLeaves", () => {
  it("keys nested values by dotted path", () => {
    const leaves = flattenLeaves([{ power: 5, elements: ["Fire"] }]);
    expect(leaves.get("0.power")).toBe(5);
    expect(leaves.get("0.elements.0")).toBe("Fire");
  });
});
