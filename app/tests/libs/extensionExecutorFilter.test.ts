import { describe, expect, it } from "vitest";
import { isExtensionExecutorEvent, isExtensionExecutorStack } from "@/utils/error";

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

describe("isExtensionExecutorEvent", () => {
  it("drops the real THENINJARPG-2QF event", () => {
    expect(
      isExtensionExecutorEvent([
        ["app:///executors/200.js", "app:///executors/200.js"],
      ]),
    ).toBe(true);
  });

  it("keeps a chained error whose LATER value holds our code", () => {
    // event.exception.values[0] is extension-only, but the cause is ours.
    expect(
      isExtensionExecutorEvent([
        ["app:///executors/200.js"],
        ["app:///src/server/api/routers/combat.ts"],
      ]),
    ).toBe(false);
  });

  it("keeps an event with no exception values", () => {
    expect(isExtensionExecutorEvent([])).toBe(false);
  });

  it("keeps an event whose value carries no frames", () => {
    expect(isExtensionExecutorEvent([[]])).toBe(false);
    expect(isExtensionExecutorEvent([["app:///executors/1.js"], []])).toBe(false);
  });
});
