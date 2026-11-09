import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { getFilter, useFiltering } from "@/layout/StatisticsFiltering";
import { getLocalDateStringMonthsAgo } from "@/utils/time";

afterEach(cleanup);

describe("statistics date filters", () => {
  it("defaults to a local month ago with no end date, like its sibling filters", () => {
    const { result } = renderHook(() => useFiltering());
    expect(result.current.startDate).toBe(getLocalDateStringMonthsAgo(1));
    expect(result.current.endDate).toBe("");
  });

  it("leaves the empty end date out of the request", () => {
    const { result } = renderHook(() => useFiltering());
    expect(getFilter(result.current)).toEqual({
      startDate: getLocalDateStringMonthsAgo(1),
    });
  });
});
