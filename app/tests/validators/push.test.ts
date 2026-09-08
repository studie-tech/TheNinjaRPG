import { describe, expect, it } from "vitest";
import { unregisterDeviceSchema } from "@/validators/push";

describe("unregisterDeviceSchema", () => {
  it("requires both the device token and its rotating owner proof", () => {
    expect(
      unregisterDeviceSchema.safeParse({
        token: "a".repeat(64),
        widgetToken: "b".repeat(32),
      }).success,
    ).toBe(true);
    expect(
      unregisterDeviceSchema.safeParse({ token: "a".repeat(64) }).success,
    ).toBe(false);
  });
});
