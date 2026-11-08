import { afterEach, describe, expect, it, vi } from "bun:test";
import { HAPTICS_STORAGE_KEY, isEnabled } from "@/libs/native/haptics";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("haptics switch", () => {
  it("stays on unless the stored preference is an explicit false", () => {
    expect(isEnabled()).toBe(true);
    for (const [stored, enabled] of [
      ["false", false],
      ["true", true],
      ["0", true],
      ['"false"', true],
      ["not json", true],
    ] as const) {
      window.localStorage.setItem(HAPTICS_STORAGE_KEY, stored);
      expect(isEnabled()).toBe(enabled);
    }
  });

  it("stays on when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(isEnabled()).toBe(true);
  });
});
