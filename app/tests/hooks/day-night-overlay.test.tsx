import { act, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY,
  useDayNightMapOverlays,
} from "@/hooks/day-night-overlay";

const OverlayProbe = () => {
  const { showDayNightMapOverlays } = useDayNightMapOverlays();
  return <div data-enabled={showDayNightMapOverlays}>{String(showDayNightMapOverlays)}</div>;
};

describe("useDayNightMapOverlays", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps server markup stable when the stored client preference is false", () => {
    window.localStorage.setItem(SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY, "false");

    expect(renderToString(<OverlayProbe />)).toBe(
      '<div data-enabled="true">true</div>',
    );
  });

  it("applies the persisted preference after hydration", async () => {
    window.localStorage.setItem(SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY, "false");
    const { result } = renderHook(() => useDayNightMapOverlays());

    await waitFor(() => {
      expect(result.current.showDayNightMapOverlays).toBe(false);
    });
  });

  it("synchronizes updates between hook instances on the same page", () => {
    const first = renderHook(() => useDayNightMapOverlays());
    const second = renderHook(() => useDayNightMapOverlays());

    act(() => first.result.current.setShowDayNightMapOverlays(false));

    expect(second.result.current.showDayNightMapOverlays).toBe(false);
    expect(window.localStorage.getItem(SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY)).toBe(
      "false",
    );
  });
});
