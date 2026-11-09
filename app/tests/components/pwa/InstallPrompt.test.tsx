import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import * as tutorial from "@/hooks/tutorial";
import * as install from "@/hooks/useInstallPrompt";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";

const hidePrompt = vi.fn();
const dismissPromptLongTerm = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(install, "useInstallPrompt").mockReturnValue({
    isVisible: true,
    hidePrompt,
    dismissPromptLongTerm,
    deferredPrompt: null,
    isInstalled: false,
    isIOS: true,
  } as ReturnType<typeof install.useInstallPrompt>);
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    currentStep: undefined,
  } as ReturnType<typeof tutorial.useTutorialStep>);
  vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({
    data: "player",
  } as ReturnType<typeof userContext.useUserDataSelector>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["/native-sign-in", "/native-sign-in/"])(
  "preserves an install offer until returning from %s to the game",
  (pathname) => {
    const route = vi.spyOn(routing, "usePublicPathname").mockReturnValue(pathname);
    const view = render(<InstallPrompt />);
    expect(view.queryByRole("heading", { name: "Install TheNinja-RPG" })).toBeNull();
    expect(hidePrompt).not.toHaveBeenCalled();
    expect(dismissPromptLongTerm).not.toHaveBeenCalled();

    route.mockReturnValue("/profile");
    view.rerender(<InstallPrompt />);
    expect(view.getByRole("heading", { name: "Install TheNinja-RPG" })).toBeTruthy();
  },
);
