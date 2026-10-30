import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useContext, useState } from "react";
import { WORLD_CYCLE_SECONDS, WORLD_DAY_SECONDS, WORLD_NIGHT_SECONDS, type UserRole } from "@/drizzle/constants";
import { DayNightIndicator } from "@/layout/DayNightIndicator";
import { getWorldCyclePosition } from "@/libs/dayNight";
import type { UserWithRelations } from "@/routers/profile";
import { UserContext } from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

const cycleStart = WORLD_CYCLE_SECONDS * 1000 * 100;
const timeDiff = 90_000;
let now = 0;
const onChange = vi.fn();
const originalCustomEvent = globalThis.CustomEvent;

/** Controlled map preview with the real clock hook and context, without shared module mocks. */
const PreviewMap = ({ role = "OWNER", editable = true, initialDate = null }: {
  role?: UserRole | null; editable?: boolean; initialDate?: Date | null;
}) => {
  const context = useContext(UserContext);
  const [date, setDate] = useState(initialDate);
  return (
    <UserContext.Provider value={{ ...context, timeDiff, data: role ? { role } as NonNullable<UserWithRelations> : undefined }}>
      <DayNightIndicator previewDate={date} onPreviewDateChange={editable ? (next) => { onChange(next); setDate(next); } : undefined} />
    </UserContext.Provider>
  );
};

beforeEach(() => {
  ensureDom();
  globalThis.CustomEvent = window.CustomEvent;
  onChange.mockClear();
  now = cycleStart + WORLD_DAY_SECONDS * 500 + timeDiff;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { cleanup(); globalThis.CustomEvent = originalCustomEvent; vi.restoreAllMocks(); });

describe("staff lighting preview", () => {
  it.each(["USER", null] as const)("keeps the badge read-only for role %s and ignores a supplied preview", (role) => {
    const view = render(<PreviewMap role={role} initialDate={new Date(cycleStart + WORLD_DAY_SECONDS * 1000 + WORLD_NIGHT_SECONDS * 500)} />);
    expect(view.queryByRole("button", { name: "Preview map lighting" })).toBeNull();
    expect(view.getByText("Day")).toBeTruthy();
    expect(view.queryByText(/Preview ·/)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps indicators without a map preview callback read-only for staff", () => {
    const view = render(<PreviewMap editable={false} />);
    expect(view.queryByRole("button", { name: "Preview map lighting" })).toBeNull();
    expect(view.getByText("Day")).toBeTruthy();
  });

  it("keeps live time ticking and a selected preview frozen", () => {
    const intervals = vi.spyOn(window, "setInterval");
    const view = render(<PreviewMap />);
    fireEvent.click(view.getByRole("button", { name: "Preview map lighting" }));
    const slider = view.getByRole("slider", { name: "Time of day" }) as HTMLInputElement;
    const tick = intervals.mock.calls.find(([, delay]) => delay === 1000)![0] as () => void;
    now = cycleStart + WORLD_DAY_SECONDS * 750 + timeDiff;
    act(tick);
    expect(slider.value).toBe("900");
    fireEvent.change(slider, { target: { value: "0" } });
    now = cycleStart + WORLD_DAY_SECONDS * 900 + timeDiff;
    act(tick);
    expect(slider.value).toBe("0");
    expect(view.getByText("Preview · 00:00")).toBeTruthy();
  });

  it("returns to a read-only live badge if staff access is removed", () => {
    const view = render(<PreviewMap initialDate={new Date(cycleStart + WORLD_DAY_SECONDS * 1000)} />);
    fireEvent.click(view.getByRole("button", { name: "Preview map lighting" }));
    view.rerender(<PreviewMap role="USER" />);
    expect(view.queryByRole("slider")).toBeNull();
    expect(view.queryByText(/Preview ·/)).toBeNull();
    expect(view.getByText("Day")).toBeTruthy();
  });

  it("scrubs both phases from a server-corrected clock and restores live time", () => {
    const view = render(<PreviewMap />);
    fireEvent.click(view.getByRole("button", { name: "Preview map lighting" }));
    const slider = view.getByRole("slider", { name: "Time of day" }) as HTMLInputElement;
    expect(slider.value).toBe("720");
    expect((view.getByRole("button", { name: "Use live world time" }) as HTMLButtonElement).disabled).toBe(true);
    for (const [minutes, phase, phaseOffset] of [
      [0, "night", WORLD_NIGHT_SECONDS * 500],
      [360, "day", 0],
      [720, "day", WORLD_DAY_SECONDS * 500],
      [1080, "night", 0],
      [1439, "night", WORLD_NIGHT_SECONDS * 1000 * 359 / 720],
    ] as const) {
      fireEvent.change(slider, { target: { value: String(minutes) } });
      const date = onChange.mock.calls.at(-1)![0] as Date;
      const position = getWorldCyclePosition(date);
      expect(position.cycleStart).toBe(cycleStart);
      expect(position.phase).toBe(phase);
      expect(position.phaseOffset).toBeCloseTo(phaseOffset);
      expect(slider.value).toBe(String(minutes));
      expect(view.getByText(/Preview ·/)).toBeTruthy();
      expect(view.queryByText(/ in /)).toBeNull();
    }
    fireEvent.click(view.getByRole("button", { name: "Use live world time" }));
    expect(onChange.mock.calls.at(-1)![0]).toBeNull();
    expect(slider.value).toBe("720");
    expect(view.queryByText(/Preview ·/)).toBeNull();
  });
});
