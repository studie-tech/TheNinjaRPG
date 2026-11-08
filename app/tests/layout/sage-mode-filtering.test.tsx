import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { getFilter, useFiltering } from "@/layout/SageModeFiltering";

afterEach(cleanup);

describe("sage mode filter", () => {
  it("omits an unset level and sends a chosen level as a number", () => {
    const { result } = renderHook(() => useFiltering());
    expect(getFilter(result.current)).not.toHaveProperty("level");
    act(() => result.current.cf.setters.level("3"));
    expect(getFilter(result.current)).toEqual(expect.objectContaining({ level: 3 }));
    act(() => result.current.cf.setters.village("village-1" as never));
    expect(Object.entries(getFilter(result.current)).filter(([key]) => key !== "hidden")).toEqual([
      ["level", 3],
      ["village", "village-1"],
    ]);
    act(() => result.current.cf.setters.level("None"));
    expect(getFilter(result.current)).not.toHaveProperty("level");
  });
});
