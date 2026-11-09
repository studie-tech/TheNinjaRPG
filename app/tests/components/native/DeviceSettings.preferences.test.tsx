import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import DeviceSettings from "@/components/native/DeviceSettings";
import * as permission from "@/hooks/useNativePush";
import * as shell from "@/hooks/useNativeShell";
import * as toast from "@/libs/toast";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { deferred } from "../../setup/deferred";

type Preferences = { categories: { category: string; enabled: boolean }[] };
let preferences: Preferences;
let write: ReturnType<typeof deferred<{ success: boolean; message: string }>>;
const setPreference = vi.fn(() => write.promise);

beforeEach(() => {
  installBrowserGlobals({ events: ["CustomEvent"] });
  preferences = {
    categories: [
      { category: "combat", enabled: false },
      { category: "system", enabled: true },
    ],
  };
  write = deferred();
  setPreference.mockClear();
  Object.assign(window, {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {},
    },
  });
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
  } as ReturnType<typeof clerk.useUser>);
  vi.spyOn(shell, "useNativeShell").mockReturnValue(true);
  vi.spyOn(permission, "useNativePushPermission").mockReturnValue({
    isSupported: true,
    permission: "granted",
    requestPermission: vi.fn(),
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    push: {
      getPreferences: { useQuery: () => ({ data: preferences }) },
      setPreference: { useMutation: () => ({ mutateAsync: setPreference }) },
      sendTest: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    useUtils: () => ({
      push: {
        getPreferences: {
          setData: (
            _input: undefined,
            update: (current: Preferences) => Preferences,
          ) => {
            preferences = update(preferences);
          },
        },
      },
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
  delete (window as Window & { Capacitor?: unknown }).Capacitor;
});

const combatSwitch = (view: ReturnType<typeof render>) =>
  view.getByRole("switch", { name: "Toggle Battles & attacks notifications" });

const startWrite = () => {
  const view = render(<DeviceSettings />);
  fireEvent.click(combatSwitch(view));
  expect(setPreference).toHaveBeenCalledWith({ category: "combat", enabled: true });
  expect(combatSwitch(view).getAttribute("aria-checked")).toBe("true");
  expect((combatSwitch(view) as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByText("Saving")).toBeTruthy();
  fireEvent.click(combatSwitch(view));
  expect(setPreference).toHaveBeenCalledTimes(1);
  return view;
};

it("keeps a confirmed preference and writes it into the cached list", async () => {
  const view = startWrite();
  await act(async () => write.resolve({ success: true, message: "Saved" }));
  expect(preferences.categories).toEqual([
    { category: "combat", enabled: true },
    { category: "system", enabled: true },
  ]);
  expect(combatSwitch(view).getAttribute("aria-checked")).toBe("true");
  expect((combatSwitch(view) as HTMLButtonElement).disabled).toBe(false);
  expect(view.queryByText("Saving")).toBeNull();
  expect(toast.showMutationToast).not.toHaveBeenCalled();
});

it("restores the cached value and reports a rejected preference", async () => {
  const view = startWrite();
  await act(async () => write.resolve({ success: false, message: "Nope" }));
  expect(toast.showMutationToast).toHaveBeenCalledWith({
    success: false,
    message: "Nope",
  });
  expect(preferences.categories[0]).toEqual({ category: "combat", enabled: false });
  expect(combatSwitch(view).getAttribute("aria-checked")).toBe("false");
  expect((combatSwitch(view) as HTMLButtonElement).disabled).toBe(false);
  expect(view.queryByText("Saving")).toBeNull();
});

it("restores the cached value after a transport failure", async () => {
  const view = startWrite();
  await act(async () => write.reject(new Error("offline")));
  expect(toast.showMutationToast).not.toHaveBeenCalled();
  expect(preferences.categories[0]).toEqual({ category: "combat", enabled: false });
  expect(combatSwitch(view).getAttribute("aria-checked")).toBe("false");
  expect((combatSwitch(view) as HTMLButtonElement).disabled).toBe(false);
  expect(view.queryByText("Saving")).toBeNull();
});
