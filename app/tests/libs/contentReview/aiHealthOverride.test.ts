import { describe, expect, it } from "bun:test";
import { editableOf } from "@/libs/contentReview/entities";
import { contentVersion } from "@/libs/contentReview/version";

describe("AI health content review", () => {
  it("retains HP suggestions and invalidates versions when HP is set or cleared", () => {
    const automatic = editableOf("AI", { username: "Boss", aiHealthOverride: null });
    const fixed = editableOf("AI", { username: "Boss", aiHealthOverride: 5_000_000 });
    expect(fixed.aiHealthOverride).toBe(5_000_000);
    expect(automatic.aiHealthOverride).toBeNull();
    expect(contentVersion(fixed)).not.toBe(contentVersion(automatic));
  });
});
