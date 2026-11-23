import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { TravelCompass } from "@/components/layout/shared/TravelCompass";
import * as context from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const home = { id: "home", name: "Horizon", sector: 1 };
let user: { userId: string; sector: number; village: typeof home | null } | undefined;
let villageError = false;
const refetch = vi.fn();

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  localStorage.clear();
  user = { userId: "compass-reader", sector: 73, village: home };
  villageError = false;
  refetch.mockClear();
  vi.spyOn(context, "useUserDataSelector").mockImplementation(
    (select) => ({ data: user ? select(user as never) : undefined }) as never,
  );
  Object.assign(vi.spyOn(client, "api" as never), {
    village: {
      getAll: {
        useQuery: () => ({
          data: villageError ? undefined : [home],
          isFetching: false,
          isError: villageError,
          refetch,
        }),
      },
    },
  });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  localStorage.clear();
  restoreBrowserGlobals();
});

it("defaults home, validates sector drafts, saves sector zero and restores focus", async () => {
  const view = render(<TravelCompass />);
  const trigger = view.getByRole("button", {
    name: /Compass: Home · Horizon. Head north/,
  });
  trigger.focus();
  fireEvent.click(trigger);
  const input = view.getByRole("spinbutton", { name: "Sector" });
  await act(async () => {
    fireEvent.input(input, { target: { value: "-1" } });
    fireEvent.submit(input.closest("form")!);
  });
  expect(view.getByRole("dialog", { name: "Destination compass" })).toBeTruthy();
  expect(view.getByRole("button", { name: /Compass: Home/ })).toBeTruthy();
  await act(async () => {
    fireEvent.input(input, { target: { value: "0" } });
    fireEvent.submit(input.closest("form")!);
    await flushRadixFocus();
  });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(
    view.getByRole("button", { name: /Compass: Sector 0. Head northwest/ }),
  ).toBeTruthy();
  await act(async () => flushRadixFocus());
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    trigger.getAttribute("aria-label"),
  );
  view.unmount();
  const restored = render(<TravelCompass />);
  expect(restored.getByRole("button", { name: /Compass: Sector 0/ })).toBeTruthy();
  user = { ...user!, sector: 0 };
  restored.rerender(<TravelCompass />);
  expect(restored.getByRole("button", { name: /You’re in this sector/ })).toBeTruthy();
});

it("keeps preferences scoped through profile loading and character switches", () => {
  localStorage.setItem(
    "travelCompass:compass-reader",
    JSON.stringify({ type: "sector", sector: 74 }),
  );
  user = undefined;
  const view = render(<TravelCompass />);
  expect(view.queryByRole("button")).toBeNull();
  user = { userId: "compass-reader", sector: 73, village: home };
  view.rerender(<TravelCompass />);
  expect(
    view.getByRole("button", { name: /Compass: Sector 74. Head east/ }),
  ).toBeTruthy();
  user = { ...user, userId: "another-reader" };
  view.rerender(<TravelCompass />);
  expect(view.getByRole("button", { name: /Compass: Home · Horizon/ })).toBeTruthy();
});

it("offers recovery from a failed village list while keeping home and sectors usable", () => {
  villageError = true;
  const view = render(<TravelCompass />);
  fireEvent.click(view.getByRole("button", { name: /Compass:/ }));
  expect(view.getByRole("alert").textContent).toContain("Villages couldn’t load");
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(
    (view.getByRole("button", { name: "Home · Horizon" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
