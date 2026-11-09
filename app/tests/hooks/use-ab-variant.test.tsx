import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { actualUseAbVariant as useAbVariant } from "../setup/preload";

const COOKIE = "ab_test_variant";

const setCookie = (value: string) => {
  document.cookie = `${COOKIE}=${encodeURIComponent(value)}; path=/`;
};

afterEach(() => {
  document.cookie = `${COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
});

describe("useAbVariant", () => {
  it("reads a configured arm from the cookie after mounting", () => {
    setCookie("treatment_2");
    const { result } = renderHook(() => useAbVariant(COOKIE));
    expect(result.current.variant).toBe("treatment_2");
  });

  it("leaves a missing, empty or unknown assignment unassigned", () => {
    const missing = renderHook(() => useAbVariant(COOKIE));
    expect(missing.result.current.variant).toBeUndefined();
    setCookie("");
    const empty = renderHook(() => useAbVariant(COOKIE));
    expect(empty.result.current.variant).toBeUndefined();
    setCookie("treatment_99");
    const unknown = renderHook(() => useAbVariant(COOKIE));
    expect(unknown.result.current.variant).toBeUndefined();
  });

  it("re-reads the cookie when the cookie name changes", () => {
    setCookie("control");
    document.cookie = "ab_other_variant=treatment_1; path=/";
    const { result, rerender } = renderHook(({ name }) => useAbVariant(name), {
      initialProps: { name: COOKIE },
    });
    expect(result.current.variant).toBe("control");
    rerender({ name: "ab_other_variant" });
    expect(result.current.variant).toBe("treatment_1");
    document.cookie =
      "ab_other_variant=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });
});
