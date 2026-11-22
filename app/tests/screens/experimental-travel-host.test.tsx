import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as navigation from "@/hooks/navigation";
import { useScreenNavigation } from "@/screens/ScreenNavigationContext";
import * as routing from "@/utils/routing";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

let starts = 0;
let stops = 0;
function MapSession({ isInteractive }: { isInteractive: boolean }) {
  useEffect(() => {
    starts++;
    return () => {
      stops++;
    };
  }, []);
  return <p>Map {isInteractive ? "active" : "paused"}</p>;
}
const dynamicSpy = vi.spyOn(dynamic, "default").mockReturnValue(MapSession as never);
const { ExperimentalTravelHost } = await import(
  "@/components/layout/ExperimentalTravelHost"
);
dynamicSpy.mockRestore();
let pathname = "/travel";
const replace = vi.fn();

function Building() {
  const { onBack } = useScreenNavigation("/village");
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button type="button" onClick={onBack}>
        Leave building
      </button>
      <input aria-label="Amount" defaultValue="" />
      <button type="button" onClick={() => setConfirm(true)}>
        Transfer
      </button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle>Confirm transfer</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

beforeEach(() => {
  starts = 0;
  stops = 0;
  pathname = "/travel";
  replace.mockClear();
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({ replace } as never);
});
afterEach(async () => {
  await act(async () => {
    cleanup();
    await flushRadixFocus();
  });
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("keeps one session across travel, direct building entries, back and forward", async () => {
  const view = render(
    <ExperimentalTravelHost isGuidedTutorial={false}>
      <p>Unused route</p>
    </ExperimentalTravelHost>,
  );
  expect(view.queryByText("Unused route")).toBeNull();
  for (const path of ["/bank", "/travel", "/itemshop", "/bank", "/travel"]) {
    pathname = path;
    await act(async () => {
      view.rerender(
        <ExperimentalTravelHost isGuidedTutorial={false}>
          <Building />
        </ExperimentalTravelHost>,
      );
      await flushRadixFocus();
    });
    expect(
      view.getByText(path === "/travel" ? "Map active" : "Map paused"),
    ).toBeTruthy();
    expect(view.queryAllByRole("dialog")).toHaveLength(path === "/travel" ? 0 : 1);
    expect(starts).toBe(1);
    expect(stops).toBe(0);
  }
});

it("returns direct building visits to travel through their header and Escape", async () => {
  pathname = "/bank";
  const view = render(
    <ExperimentalTravelHost isGuidedTutorial={false}>
      <Building />
    </ExperimentalTravelHost>,
  );
  expect(view.getByRole("dialog", { name: "Bank" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Leave building" }));
  expect(replace).toHaveBeenCalledWith("/travel", { scroll: false });
  replace.mockClear();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(replace).toHaveBeenCalledWith("/travel", { scroll: false });
});

it("dismisses nested confirmations without closing the building or clearing its form", async () => {
  pathname = "/bank";
  const view = render(
    <ExperimentalTravelHost isGuidedTutorial={false}>
      <Building />
    </ExperimentalTravelHost>,
  );
  fireEvent.change(view.getByRole("textbox", { name: "Amount" }), {
    target: { value: "25" },
  });
  fireEvent.click(view.getByRole("button", { name: "Transfer" }));
  await act(async () => {
    await flushRadixFocus();
  });
  expect(view.getByRole("dialog", { name: "Confirm transfer" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await act(async () => {
    await flushRadixFocus();
  });
  expect(replace).not.toHaveBeenCalled();
  expect(
    (view.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value,
  ).toBe("25");
});

it("keeps tutorial controls outside a building reachable while the map is inert", () => {
  pathname = "/itemshop";
  const view = render(
    <>
      <button type="button">Tutorial next</button>
      <ExperimentalTravelHost isGuidedTutorial>
        <Building />
      </ExperimentalTravelHost>
    </>,
  );
  expect(view.getByRole("button", { name: "Tutorial next" })).toBeTruthy();
  expect(view.getByText("Map paused").parentElement?.hasAttribute("inert")).toBe(true);
});
