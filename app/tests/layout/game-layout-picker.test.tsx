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
import { mockUserContextValue } from "../setup/userContext";

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
  mockUserContextValue({
    data: { userId: "player" },
    userId: "player",
    isClerkLoaded: true,
    isSignedIn: true,
  });
});

afterEach(async () => {
  await act(async () => {
    cleanup();
    await flushRadixFocus();
  });
  vi.restoreAllMocks();
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

  it.each([
    {
      label: "created character",
      isClerkLoaded: true,
      isSignedIn: true,
      userId: "player",
      data: { userId: "player" },
      allowed: true,
    },
    {
      label: "no character",
      isClerkLoaded: true,
      isSignedIn: true,
      userId: "player",
      data: undefined,
      allowed: false,
    },
    {
      label: "loading auth",
      isClerkLoaded: false,
      isSignedIn: true,
      userId: "player",
      data: { userId: "player" },
      allowed: false,
    },
    {
      label: "signed out",
      isClerkLoaded: true,
      isSignedIn: false,
      userId: "player",
      data: { userId: "player" },
      allowed: false,
    },
    {
      label: "stale account profile",
      isClerkLoaded: true,
      isSignedIn: true,
      userId: "other",
      data: { userId: "player" },
      allowed: false,
    },
  ])(
    "admits sector selection only for a signed-in character: $label",
    async ({ allowed, ...session }) => {
      const router = getRouter();
      router.replace.mockClear();
      mockUserContextValue(session);
      function SelectExperiment() {
        const selectLayout = useSelectGameLayout();
        return (
          <button type="button" onClick={() => selectLayout("sector")}>
            Try sector
          </button>
        );
      }
      const view = render(<SelectExperiment />);
      fireEvent.click(view.getByRole("button", { name: "Try sector" }));
      if (allowed) {
        expect(router.replace).toHaveBeenCalledWith("/travel");
        expect(document.cookie).toContain(`${LAYOUT_PREFERENCE_COOKIE}=sector`);
      } else {
        expect(router.replace).not.toHaveBeenCalled();
        expect(localStorage.getItem(LAYOUT_PREFERENCE_COOKIE)).toBeNull();
        expect(document.cookie).not.toContain(`${LAYOUT_PREFERENCE_COOKIE}=sector`);
      }
    },
  );

  it("omits the sector choice before character creation", async () => {
    mockUserContextValue({
      isClerkLoaded: true,
      isSignedIn: true,
      userId: "new-player",
      status: "success",
    });
    const view = await openPicker();
    expect(view.queryByRole("option", { name: "Sector Layout" })).toBeNull();
    expect(view.getByRole("option", { name: "Classic" })).toBeTruthy();
  });

  it("offers the layouts including the opt-in experiment in one selector", async () => {
    const view = await openPicker();
    expect(view.getAllByRole("listbox")).toHaveLength(1);
    expect(view.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Classic",
      "Pixel",
      "Eclipse Observatory",
      "Obsidian Council",
      "Sakura Courtyard",
      "Sector Layout",
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
