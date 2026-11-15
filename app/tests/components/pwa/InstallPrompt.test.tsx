import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import { TUTORIAL_STEPS_COUNT } from "@/drizzle/constants";
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
  mockPlayer({ tutorialOn: true, tutorialStep: TUTORIAL_STEPS_COUNT });
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

it.each([
  { tutorialOn: true, tutorialStep: 0 },
  { tutorialOn: true, tutorialStep: TUTORIAL_STEPS_COUNT - 1 },
])("stays out of the way of an active tutorial (%o)", (tutorial) => {
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  mockPlayer(tutorial);
  const view = render(<InstallPrompt />);
  expect(view.queryByRole("heading", { name: "Install TheNinja-RPG" })).toBeNull();
});

it("returns once the tutorial is switched off", () => {
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  mockPlayer({ tutorialOn: false, tutorialStep: 0 });
  const view = render(<InstallPrompt />);
  expect(view.getByRole("heading", { name: "Install TheNinja-RPG" })).toBeTruthy();
});

/** A signed-in player with the given tutorial progress. */
function mockPlayer(tutorial: { tutorialOn: boolean; tutorialStep: number }) {
  vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({
    data: { userId: "player", ...tutorial },
  } as ReturnType<typeof userContext.useUserDataSelector>);
}
