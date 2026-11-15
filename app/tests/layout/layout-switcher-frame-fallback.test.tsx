import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as ClassicGameLayout from "@/components/layout/ClassicGameLayout";
import * as LayoutParticles from "@/components/layout/shared/LayoutParticles";
import { useGlobalAudio } from "@/layout/GlobalAudioProvider";
import LayoutSwitcher from "@/layout/LayoutSwitcher";
import * as routing from "@/utils/routing";
import { testRouter } from "../setup/router";
import { mockUserContextValue } from "../setup/userContext";

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue(testRouter("frame-fallback"));
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/combat");
  vi.spyOn(Sentry, "captureException").mockImplementation(() => "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(LayoutParticles, "LayoutParticles").mockImplementation(() => null);
  mockUserContextValue({
    data: { userId: "player", status: "BATTLE", musicOn: false, sfxOn: false },
    isClerkLoaded: true,
    isSignedIn: true,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A page reading the audio settings, like the combat settings on /combat. */
const AudioSettingsPage = () => {
  const { audioEnabled } = useGlobalAudio();
  return <p>{audioEnabled ? "music on" : "music off"}</p>;
};

it("keeps a page that reads the audio settings usable when its frame fails", async () => {
  vi.spyOn(ClassicGameLayout, "ClassicGame").mockImplementation(() => {
    throw new Error("Failed to load chunk");
  });
  const view = render(
    <LayoutSwitcher initialIsSignedIn initialLayout="default">
      <AudioSettingsPage />
    </LayoutSwitcher>,
  );
  expect(await view.findByText("The page layout could not be loaded.")).toBeTruthy();
  expect(view.getByText("music off")).toBeTruthy();
  expect(view.getByRole("button", { name: "Reload" })).toBeTruthy();
});
