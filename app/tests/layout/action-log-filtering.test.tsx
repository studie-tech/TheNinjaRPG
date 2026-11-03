import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { getFilter, useFiltering } from "@/layout/ActionLogFiltering";

afterEach(cleanup);

describe("action log filter defaults", () => {
  it("queries the requested log type", () => {
    const view = renderHook(() => useFiltering("clan"));
    expect(view.result.current.logtype).toBe("clan");
    expect(getFilter(view.result.current).logtype).toBe("clan");
  });

  it("defaults to user logs", () => {
    const view = renderHook(() => useFiltering());
    expect(getFilter(view.result.current).logtype).toBe("user");
  });
});
