import { describe, expect, it } from "vitest";
import { QuestValidatorRawSchema } from "@/validators/objectives";

describe("QuestValidatorRawSchema requiredSageRank", () => {
  const shape = QuestValidatorRawSchema.shape.requiredSageRank;

  it("parses an empty string (reset button) to null", () => {
    expect(shape.parse("")).toBeNull();
  });

  it("accepts a valid rank", () => {
    expect(shape.parse("MASTER")).toBe("MASTER");
  });

  it("accepts null", () => {
    expect(shape.parse(null)).toBeNull();
  });

  it("accepts undefined", () => {
    expect(shape.parse(undefined)).toBeUndefined();
  });

  it("rejects an invalid rank", () => {
    expect(() => shape.parse("BOGUS")).toThrow();
  });
});
