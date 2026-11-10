import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Toggle from "@/components/control/Toggle";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("names its switch with the label and toggles from a label click", () => {
  const setShowActive = vi.fn();
  render(
    <Toggle
      value={true}
      labelActive="Show all"
      labelInactive="Show selected"
      setShowActive={setShowActive}
    />,
  );
  fireEvent.click(screen.getByText("Show all"));
  expect(screen.getByRole("switch", { name: "Show all" })).toBeTruthy();
  expect(setShowActive).toHaveBeenCalledWith(false);
});
