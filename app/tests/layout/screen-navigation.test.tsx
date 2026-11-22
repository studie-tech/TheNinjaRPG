import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import * as navigation from "@/hooks/navigation";
import ContentBox, * as contentBox from "@/layout/ContentBox";
import * as routing from "@/utils/routing";
import {
  ScreenNavigationProvider,
  useScreenNavigation,
} from "@/utils/ScreenNavigationContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { actualContentBox } from "../setup/preload";

const back = vi.fn();
const push = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(contentBox, "default").mockImplementation(actualContentBox);
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({ back, push } as never);
  vi.spyOn(routing, "hasInAppPreviousEntry").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

function Screen() {
  const navigation = useScreenNavigation("/village");
  const [isInspecting, setIsInspecting] = useState(false);
  return (
    <>
      <ContentBox title="Building" {...navigation}>
        <input aria-label="Draft" defaultValue="" />
        <button type="button" onClick={() => setIsInspecting(true)}>
          Inspect
        </button>
      </ContentBox>
      {isInspecting && (
        <ContentBox
          title="Details"
          initialBreak
          defaultBackHref="/building"
          onBack={() => setIsInspecting(false)}
        >
          Details
        </ContentBox>
      )}
    </>
  );
}

it("uses the page fallback on direct entry and in-app history when available", () => {
  const view = render(<Screen />);
  fireEvent.click(view.getByRole("button", { name: "Building" }));
  expect(push).toHaveBeenCalledWith("/village");
  expect(back).not.toHaveBeenCalled();
  vi.spyOn(routing, "hasInAppPreviousEntry").mockReturnValue(true);
  fireEvent.click(view.getByRole("button", { name: "Building" }));
  expect(back).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledTimes(1);
});

it("lets the host close the screen without navigating browser history", () => {
  vi.spyOn(routing, "hasInAppPreviousEntry").mockReturnValue(true);
  const close = vi.fn();
  const view = render(
    <ScreenNavigationProvider onBack={close}>
      <Screen />
    </ScreenNavigationProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Building" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
  expect(back).not.toHaveBeenCalled();
});

it("keeps nested back actions inside the screen", () => {
  const close = vi.fn();
  const view = render(
    <ScreenNavigationProvider onBack={close}>
      <Screen />
    </ScreenNavigationProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Inspect" }));
  fireEvent.click(view.getByRole("button", { name: "Details" }));
  expect(view.queryByRole("heading", { name: "Details" })).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(back).not.toHaveBeenCalled();
});

it("updates host navigation without remounting screen state", () => {
  const first = vi.fn();
  const second = vi.fn();
  const view = render(
    <ScreenNavigationProvider onBack={first}>
      <Screen />
    </ScreenNavigationProvider>,
  );
  const draft = view.getByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "Unsubmitted amount" } });
  view.rerender(
    <ScreenNavigationProvider onBack={second}>
      <Screen />
    </ScreenNavigationProvider>,
  );
  expect(view.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Unsubmitted amount");
  fireEvent.click(view.getByRole("button", { name: "Building" }));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
