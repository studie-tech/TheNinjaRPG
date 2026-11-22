import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ActionSelector } from "@/layout/CombatActions";
import { mockUserContextValue } from "../setup/userContext";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

beforeEach(() => {
  mockUserContextValue({ data: undefined } as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  if (originalMatchMedia)
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
});

/** Report whether the device has a mouse or trackpad. */
const setFinePointer = (fine: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(any-pointer: fine)" && fine }),
  });

const renderActions = () => {
  const onAssignHotkey = vi.fn();
  const view = render(
    <ActionSelector
      items={[{ id: "fireball", name: "Fireball", image: "", type: "jutsu" }] as never}
      showBgColor={false}
      showLabels={false}
      hotkeys={{ fireball: "f" }}
      onAssignHotkey={onAssignHotkey}
      onClick={vi.fn()}
      renderItem={(item) => <span>{item.name}</span>}
    />,
  );
  const target = view.getByText("Fireball");
  const openContextMenu = (pointerType?: string) => {
    const event = new window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    if (pointerType)
      Object.defineProperty(event, "pointerType", { value: pointerType });
    fireEvent(target, event);
    return event;
  };
  return { view, onAssignHotkey, openContextMenu };
};

it("opens hotkey assignment from a right-click on devices with a mouse or trackpad", () => {
  setFinePointer(true);
  const { onAssignHotkey, openContextMenu } = renderActions();
  expect(openContextMenu().defaultPrevented).toBe(true);
  expect(onAssignHotkey).toHaveBeenCalledTimes(1);
});

it("leaves a touch-only long press alone and hides the key badge", () => {
  setFinePointer(false);
  const { view, onAssignHotkey, openContextMenu } = renderActions();
  expect(openContextMenu().defaultPrevented).toBe(false);
  expect(onAssignHotkey).not.toHaveBeenCalled();
  expect(view.getByText("F").className).toContain("not-any-pointer-fine:hidden");
});

it("leaves a touch long press alone on hybrid devices with a mouse or trackpad", () => {
  setFinePointer(true);
  const { onAssignHotkey, openContextMenu } = renderActions();
  expect(openContextMenu("touch").defaultPrevented).toBe(false);
  expect(onAssignHotkey).not.toHaveBeenCalled();
  expect(openContextMenu("mouse").defaultPrevented).toBe(true);
  expect(onAssignHotkey).toHaveBeenCalledTimes(1);
});

it("selects owned copies independently while assigning hotkeys to their template", () => {
  setFinePointer(true);
  const onClick = vi.fn();
  const onAssignHotkey = vi.fn();
  const view = render(
    <ActionSelector
      items={[
        {
          id: "weapon",
          userItemId: "first",
          name: "First copy",
          image: "",
          type: "item",
        },
        {
          id: "weapon",
          userItemId: "second",
          name: "Second copy",
          image: "",
          type: "item",
        },
      ]}
      combatMode
      selectedId="second"
      showBgColor={false}
      showLabels={false}
      hotkeys={{ weapon: "w" }}
      onAssignHotkey={onAssignHotkey}
      onClick={onClick}
    />,
  );
  const first = view.getByRole("button", { name: /^First copy$/ });
  const second = view.getByRole("button", { name: /^Second copy$/ });
  expect(first.getAttribute("aria-pressed")).toBe("false");
  expect(second.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(second);
  expect(onClick).toHaveBeenCalledWith("second");
  fireEvent.contextMenu(second);
  expect(onAssignHotkey).toHaveBeenCalledWith(
    expect.objectContaining({ id: "weapon", userItemId: "second" }),
  );
  expect(view.getAllByText("W")).toHaveLength(2);
});
