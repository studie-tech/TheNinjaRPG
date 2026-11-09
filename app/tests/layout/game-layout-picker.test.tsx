import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useSelectGameLayout } from "@/hooks/useGameLayout";
import { GameLayoutPicker } from "@/layout/GameLayoutPicker";
import { GAME_LAYOUTS, type GameLayoutId } from "@/libs/gameLayouts";
import { LAYOUT_PREFERENCE_COOKIE } from "@/libs/layoutPreference";
import { LayoutContextProvider, useActiveLayout } from "@/utils/LayoutContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

type PickerRouter = {
  refresh: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
};
// Module mocks persist across suites, so this file installs its own router.
function getRouter(): PickerRouter {
  const globals = globalThis as typeof globalThis & {
    __layoutPickerRouter?: PickerRouter;
  };
  globals.__layoutPickerRouter ??= {
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  };
  return globals.__layoutPickerRouter;
}
vi.mock("next/navigation", () => ({ useRouter: () => getRouter() }));

beforeEach(() => {
  localStorage.removeItem(LAYOUT_PREFERENCE_COOKIE);
  document.cookie = `${LAYOUT_PREFERENCE_COOKIE}=; path=/; max-age=0`;
  installBrowserGlobals({ scrollIntoView: true });
});

afterEach(async () => {
  await act(async () => {
    cleanup();
    await flushRadixFocus();
  });
  restoreBrowserGlobals();
});

const openPicker = async (layout: GameLayoutId = "default") => {
  const onLayoutChange = vi.fn();
  const view = render(
    <GameLayoutPicker layout={layout} onLayoutChange={onLayoutChange} />,
  );
  expect(view.getAllByRole("combobox")).toHaveLength(1);
  fireEvent.keyDown(view.getByRole("combobox", { name: "Game layout" }), {
    key: "ArrowDown",
  });
  await view.findByRole("option", { name: "Classic" });
  return { ...view, onLayoutChange };
};

describe("game layout picker", () => {
  it("changes layouts in place and refreshes the router cache without navigating", async () => {
    const router = getRouter();
    router.refresh.mockClear();
    router.push.mockClear();
    router.replace.mockClear();
    function ConnectedPicker() {
      const selectLayout = useSelectGameLayout();
      const layout = useActiveLayout();
      return <GameLayoutPicker layout={layout} onLayoutChange={selectLayout} />;
    }
    function LayoutFrame() {
      const [layout, setLayout] = useState<GameLayoutId>("default");
      return (
        <LayoutContextProvider
          value={layout}
          onLayoutChange={setLayout}
          isPixelLanding={false}
        >
          <ConnectedPicker />
        </LayoutContextProvider>
      );
    }
    const view = render(<LayoutFrame />);
    fireEvent.keyDown(view.getByRole("combobox", { name: "Game layout" }), {
      key: "ArrowDown",
    });
    await act(async () =>
      fireEvent.keyDown(
        await view.findByRole("option", { name: "Eclipse Observatory" }),
        { key: "Enter" },
      ),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(view.getByRole("combobox", { name: "Game layout" }).textContent).toContain(
      "Eclipse Observatory",
    );
    expect(document.cookie).toContain(
      `${LAYOUT_PREFERENCE_COOKIE}=20-eclipse-observatory`,
    );
    expect(localStorage.getItem(LAYOUT_PREFERENCE_COOKIE)).toBe(
      '"20-eclipse-observatory"',
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.keyDown(view.getByRole("combobox", { name: "Game layout" }), {
      key: "ArrowDown",
    });
    await act(async () =>
      fireEvent.keyDown(await view.findByRole("option", { name: "Sakura Courtyard" }), {
        key: "Enter",
      }),
    );
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(LAYOUT_PREFERENCE_COOKIE)).toBe('"3-sakura-courtyard"');
  });

  it("offers all five layouts as peers in one selector", async () => {
    const view = await openPicker();
    expect(view.getAllByRole("listbox")).toHaveLength(1);
    expect(view.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Classic",
      "Pixel",
      "Eclipse Observatory",
      "Obsidian Council",
      "Sakura Courtyard",
    ]);
  });

  it.each([...GAME_LAYOUTS])(
    "selects $name using its own layout ID",
    async ({ name, id }) => {
      const view = await openPicker(id === "default" ? "pixel" : "default");
      await act(async () =>
        fireEvent.keyDown(view.getByRole("option", { name }), { key: "Enter" }),
      );
      await waitFor(() => expect(view.onLayoutChange).toHaveBeenCalledWith(id));
    },
  );

  it.each([...GAME_LAYOUTS])(
    "restores $name directly as the current option",
    async ({ name, id }) => {
      const view = await openPicker(id);
      expect(view.getByRole("option", { name }).getAttribute("aria-selected")).toBe(
        "true",
      );
    },
  );
});
