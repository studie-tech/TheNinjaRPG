import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as SelectModule from "@/components/ui/select";
import * as localstorage from "@/hooks/localstorage";
import { MobileNavSettings } from "@/layout/profileEdit/MobileNavSettings";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  MOBILE_NAV_STORAGE_KEY,
} from "@/libs/mobileNavConfig";

const setConfig = vi.fn();

beforeEach(() => {
  setConfig.mockClear();
  vi.spyOn(localstorage, "useLocalStorage").mockImplementation(((key: string) => {
    expect(key).toBe(MOBILE_NAV_STORAGE_KEY);
    return [DEFAULT_MOBILE_NAV_CONFIG, setConfig];
  }) as never);
  vi.spyOn(SelectModule, "Select").mockImplementation((({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <input
      aria-label="Shortcut"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  )) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("replaces only the chosen slot on its own side", () => {
  const view = render(<MobileNavSettings />);
  const slots = view.getAllByRole("textbox", {
    name: "Shortcut",
  }) as HTMLInputElement[];
  expect(slots.map((slot) => slot.value)).toEqual([
    ...DEFAULT_MOBILE_NAV_CONFIG.left,
    ...DEFAULT_MOBILE_NAV_CONFIG.right,
  ]);
  fireEvent.change(slots[1] as HTMLInputElement, { target: { value: "bank" } });
  expect(setConfig).toHaveBeenLastCalledWith({
    left: ["profile", "bank"],
    right: ["items", "tavern", "settings"],
  });
  fireEvent.change(slots[4] as HTMLInputElement, { target: { value: "bank" } });
  expect(setConfig).toHaveBeenLastCalledWith({
    left: ["profile", "inbox"],
    right: ["items", "tavern", "bank"],
  });
  fireEvent.click(view.getByRole("button", { name: "Reset to Default" }));
  expect(setConfig).toHaveBeenLastCalledWith(DEFAULT_MOBILE_NAV_CONFIG);
});
