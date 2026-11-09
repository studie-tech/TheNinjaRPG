import { afterEach, expect, it } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getFilter, useFiltering } from "@/layout/SkillTreeBalanceFiltering";

afterEach(cleanup);

it("leaves the default minimum count to the statistics endpoint", () => {
  const { result } = renderHook(() => useFiltering());
  expect(getFilter(result.current)).toEqual({});
});

it("sends the chosen minimum count, effects and numeric tiers", async () => {
  const { result } = renderHook(() => useFiltering());
  act(() => {
    result.current.cf.setters.minCount(5);
    result.current.cf.setters.skillEffects(["damage"]);
    result.current.cf.setters.tiers(["2", "10"]);
  });
  await waitFor(
    () =>
      expect(getFilter(result.current)).toEqual({
        minCount: 5,
        skillEffects: ["damage"],
        tiers: [2, 10],
      }),
    { timeout: 2000 },
  );
});

it("omits a minimum count below one", async () => {
  const { result } = renderHook(() => useFiltering());
  act(() => result.current.cf.setters.minCount(0));
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(getFilter(result.current)).toEqual({});
});
