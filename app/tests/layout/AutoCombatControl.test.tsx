import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AutoCombatBadge, AutoCombatControl } from "@/layout/AutoCombatControl";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
});
afterEach(async () => {
  cleanup();
  await act(flushRadixFocus);
  restoreBrowserGlobals();
});

const mount = (overrides: Partial<Parameters<typeof AutoCombatControl>[0]> = {}) => {
  const onChange = vi.fn();
  const props = {
    isActive: false,
    isPending: false,
    requiresConfirmation: true,
    onChange,
    ...overrides,
  };
  return { ...render(<AutoCombatControl {...props} />), onChange, props };
};

it("requires confirmation to enable PvP AI and leaves cancellation manual", () => {
  const view = mount();
  const toggle = view.getByRole("switch", { name: "Auto combat" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  expect(view.getByRole("dialog")).toBeDefined();
  expect(view.onChange).not.toHaveBeenCalled();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(view.getAllByRole("button", { name: "Close" }).at(-1)!);
  expect(view.onChange).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  fireEvent.click(view.getByRole("button", { name: "Enable auto combat" }));
  expect(view.onChange).toHaveBeenCalledTimes(1);
  expect(view.onChange).toHaveBeenCalledWith(true);
});

it("shows restored AI state and returns to manual without confirmation", () => {
  const view = mount({ isActive: true });
  expect(
    view.getByRole("switch", { name: "Auto combat" }).getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(view.getByRole("switch", { name: "Auto combat" }));
  expect(view.onChange).toHaveBeenCalledTimes(1);
  expect(view.onChange).toHaveBeenCalledWith(false);
  expect(view.queryByRole("dialog")).toBeNull();
});

it("preserves the direct PvE toggle and explains its saved preference", () => {
  const view = mount({ requiresConfirmation: false });
  fireEvent.click(view.getByRole("switch", { name: "Auto combat" }));
  expect(view.onChange).toHaveBeenCalledTimes(1);
  expect(view.onChange).toHaveBeenCalledWith(true);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByText(/future non-PvP battles/)).toBeDefined();
});

it("disables the control while saving and shows failed changes beside it", () => {
  const view = mount({
    isPending: true,
    error: "You are no longer fighting in this battle",
  });
  fireEvent.click(view.getByRole("switch", { name: "Auto combat" }));
  expect(view.onChange).not.toHaveBeenCalled();
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByRole("alert").textContent).toContain("no longer fighting");
});

it("discards an unconfirmed handover when a different battle mounts", () => {
  const view = mount();
  fireEvent.click(view.getByRole("switch", { name: "Auto combat" }));
  view.rerender(<AutoCombatControl key="next-battle" {...view.props} />);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.onChange).not.toHaveBeenCalled();
});

it("confirms a PvP handover from inside the settings popover", () => {
  const onChange = vi.fn();
  const view = render(
    <Popover>
      <PopoverTrigger>Combat settings</PopoverTrigger>
      <PopoverContent>
        <AutoCombatControl
          isActive={false}
          isPending={false}
          requiresConfirmation
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>,
  );
  fireEvent.click(view.getByRole("button", { name: "Combat settings" }));
  fireEvent.click(view.getByRole("switch", { name: "Auto combat" }));
  const confirm = view.getByRole("button", { name: "Enable auto combat" });
  fireEvent.pointerDown(confirm);
  fireEvent.click(confirm);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(true);
});

it("returns control directly through the battlefield badge and blocks duplicate pending clicks", () => {
  const onDisable = vi.fn();
  const view = render(<AutoCombatBadge isPending={false} onDisable={onDisable} />);
  fireEvent.click(view.getByRole("button", { name: "Disable auto combat" }));
  expect(onDisable).toHaveBeenCalledTimes(1);
  view.rerender(<AutoCombatBadge isPending onDisable={onDisable} />);
  expect(view.getByText("Taking control…")).toBeDefined();
  fireEvent.click(view.getByRole("button", { name: "Disable auto combat" }));
  expect(onDisable).toHaveBeenCalledTimes(1);
});

it("shows a noninteractive badge when the match requires auto combat", () => {
  const view = render(<AutoCombatBadge isPending={false} />);
  expect(view.getByRole("status").textContent).toContain("Auto combat");
  expect(view.queryByRole("button")).toBeNull();
});
