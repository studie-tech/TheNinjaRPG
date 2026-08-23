import { describe, expect, it } from "vitest";
import { isExtensionExecutorStack } from "@/utils/error";

describe("isExtensionExecutorStack", () => {
  it("matches the real THENINJARPG-2QF stack", () => {
    // Verbatim frames from the Sentry event: 858 occurrences, 2 users, no app frame.
    expect(
      isExtensionExecutorStack(["app:///executors/200.js", "app:///executors/200.js"]),
    ).toBe(true);
  });

  it("keeps an error that touches any of our own code", () => {
    expect(
      isExtensionExecutorStack([
        "app:///executors/200.js",
        "app:///src/app/profile/page.tsx",
      ]),
    ).toBe(false);
  });

  it("keeps an error with no stack at all", () => {
    expect(isExtensionExecutorStack([])).toBe(false);
  });

  it("does not match an app path that merely mentions executors", () => {
    expect(isExtensionExecutorStack(["app:///src/libs/executors/helper.ts"])).toBe(false);
  });

  it("ignores undefined frame paths rather than treating them as a match", () => {
    expect(isExtensionExecutorStack([undefined])).toBe(false);
  });
});
