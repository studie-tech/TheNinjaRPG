import * as clerk from "@clerk/nextjs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { SignedInIcons } from "@/components/layout/shared/LayoutSidebars";
import * as nativeEntry from "@/components/native/NativeSettingsEntry";
import * as audioHook from "@/hooks/useAudio";
import * as gameLayoutHook from "@/hooks/useGameLayout";
import * as iframeHook from "@/hooks/useIframeMute";
import * as layoutPicker from "@/layout/GameLayoutPicker";
import {
  GameSettingsPanel,
  GameSettingsPopover,
  SETTINGS_HREF,
} from "@/layout/GameSettings";
import { GlobalAudioProvider } from "@/layout/GlobalAudioProvider";
import { hasTutorialReminder, TutorialSettings } from "@/layout/TutorialSettings";
import * as audioPreferences from "@/libs/audioPreferences";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import * as audioUtils from "@/utils/audio";
import * as userContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const MUSIC = "Music";
const SFX = "Combat sounds";
const LIGHTING = "Day/night colors";
const SIDEBARS = "Swap sidebars";

let preferenceCallbacks: Parameters<
  typeof client.api.profile.updatePreferences.useMutation
>[0];

beforeEach(() => {
  window.localStorage.clear();
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(audioPreferences, "isLocalAudioSession").mockReturnValue(false);
  vi.spyOn(audioHook, "useAudio").mockImplementation(() => ({
    isPlaying: false,
    requiresInteraction: false,
    enabled: true,
    setEnabled: vi.fn(async () => undefined),
  }));
  vi.spyOn(audioUtils, "playPreloadedAudio").mockResolvedValue(undefined);
  vi.spyOn(audioUtils, "preloadAudioBuffers").mockResolvedValue(undefined);
  vi.spyOn(iframeHook, "useIframeMute").mockReturnValue({
    isIframesMuted: false,
    setIframesMuted: vi.fn(),
  });
  vi.spyOn(gameLayoutHook, "useSelectGameLayout").mockReturnValue(vi.fn());
  vi.spyOn(layoutPicker, "GameLayoutPicker").mockReturnValue(null as never);
  vi.spyOn(nativeEntry, "NativeSettingsEntry").mockReturnValue(null as never);
  vi.spyOn(clerk, "UserButton").mockReturnValue(null as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: {
      updatePreferences: {
        useMutation: (options: typeof preferenceCallbacks) => {
          preferenceCallbacks = options;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  });
});

afterEach(async () => {
  cleanup();
  await act(flushRadixFocus);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  restoreBrowserGlobals();
});

const renderInAudio = (node: React.ReactNode) =>
  render(<GlobalAudioProvider>{node}</GlobalAudioProvider>);

describe("game settings sections", () => {
  it("shows only sound controls for the sound section", () => {
    renderInAudio(
      <section>
        <h2>Sound &amp; music</h2>
        <p>Music, sound effects, and effect volume</p>
        <GameSettingsPanel section="audio" />
      </section>,
    );
    expect(screen.getAllByText("Sound & music")).toHaveLength(1);
    expect(screen.queryByText("Audio")).toBeNull();
    expect(screen.getByLabelText(MUSIC)).toBeTruthy();
    expect(screen.getByLabelText(SFX)).toBeTruthy();
    expect(screen.queryByLabelText(LIGHTING)).toBeNull();
    expect(screen.queryByLabelText(SIDEBARS)).toBeNull();
  });

  it("labels both effects volume sliders when the sound panel and quick controls are open", async () => {
    renderInAudio(
      <>
        <GameSettingsPanel section="audio" />
        <GameSettingsPopover section="audio" />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Audio settings" }));
    });
    expect(screen.getAllByText("Audio")).toHaveLength(1);
    const sliders = screen.getAllByRole("slider", {
      name: /^Effects volume\s*80%$/,
    });
    expect(sliders).toHaveLength(2);

    fireEvent.change(sliders[1]!, { target: { value: "45" } });
    expect(
      screen.getAllByRole("slider", { name: /^Effects volume\s*45%$/ }),
    ).toHaveLength(2);
    expect(sliders.map((slider) => (slider as HTMLInputElement).value)).toEqual([
      "45",
      "45",
    ]);
  });

  it("shows only layout and display controls for the display section", () => {
    renderInAudio(
      <section>
        <h2>Game layout</h2>
        <p>Layout, lighter layout, and sidebars</p>
        <GameSettingsPanel section="display" />
      </section>,
    );
    expect(screen.getAllByText("Game layout")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Explore layouts" }).getAttribute("href"),
    ).toBe("/layouts");
    expect(screen.getByLabelText("Lighter layout")).toBeTruthy();
    expect(screen.getByLabelText(SIDEBARS)).toBeTruthy();
    expect(screen.queryByLabelText(LIGHTING)).toBeNull();
    expect(screen.queryByLabelText(MUSIC)).toBeNull();
    expect(screen.queryByLabelText(SFX)).toBeNull();
  });

  it("exposes each graphics preference in the visual effects section", () => {
    renderInAudio(
      <section>
        <h2>Visual effects</h2>
        <p>Lighting, shadows, and animations</p>
        <GameSettingsPanel section="effects" />
      </section>,
    );
    expect(screen.getAllByText("Visual effects")).toHaveLength(1);
    expect(screen.queryByText("Adjust graphics for your device.")).toBeNull();
    expect(
      screen.getByText("Shared across the game; saved on this device."),
    ).toBeTruthy();
    for (const label of [
      "Sunlight",
      LIGHTING,
      "Local lights",
      "Shadows",
      "Weather",
      "Wind",
      "Sprite animations",
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    fireEvent.click(screen.getByLabelText(LIGHTING));
    expect((screen.getByLabelText("Shadows") as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByLabelText(MUSIC)).toBeNull();
    expect(screen.queryByLabelText(SIDEBARS)).toBeNull();
  });

  it("keeps all three categories in the full panel for signed-out visitors", () => {
    renderInAudio(<GameSettingsPanel />);
    expect(screen.getByLabelText(MUSIC)).toBeTruthy();
    expect(screen.getByLabelText(SFX)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Game layout" }), {
      button: 0,
    });
    expect(screen.getAllByText("Game layout")).toHaveLength(1);
    expect(screen.getByLabelText(SIDEBARS)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Visual effects" }), {
      button: 0,
    });
    expect(screen.getAllByText("Visual effects")).toHaveLength(1);
    for (const label of [
      "Sunlight",
      LIGHTING,
      "Local lights",
      "Shadows",
      "Weather",
      "Wind",
      "Sprite animations",
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("gives character owners a top-bar settings gear with sound controls and a link to all settings", async () => {
    renderInAudio(
      <SignedInIcons
        variant="default"
        isSignedIn
        userData={{
          musicOn: true,
          buttonSfxOn: true,
          sfxOn: true,
          village: null,
          isOutlaw: false,
          bloodlineId: null,
          status: "AWAKE",
          preferredGeneral1: null,
          preferredGeneral2: null,
        }}
        updateUser={async () => undefined}
        onEventClick={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Game settings" }));
    });
    expect(screen.getByLabelText(MUSIC)).toBeTruthy();
    expect(screen.queryByLabelText(LIGHTING)).toBeNull();
    const link = screen.getByRole("link", { name: "All settings" });
    expect(link.getAttribute("href")).toBe(SETTINGS_HREF);
    expect(screen.queryByRole("tab", { name: "Game layout" })).toBeNull();
  });

  it.each([true, false])(
    "marks the top-bar settings gear only while music is off (music on: %p)",
    (musicOn) => {
      const playing = audioHook.useAudio({ src: "" });
      vi.spyOn(audioHook, "useAudio").mockImplementation(() => ({
        ...playing,
        enabled: musicOn,
      }));
      renderInAudio(
        <SignedInIcons
          variant="default"
          isSignedIn
          updateUser={async () => undefined}
          onEventClick={() => {}}
        />,
      );
      const mark = screen
        .getByRole("button", { name: "Game settings" })
        .querySelector("[data-muted-mark]");
      expect(mark).not.toBeNull();
      expect(mark?.getAttribute("class")?.split(" ").includes("hidden")).toBe(musicOn);
    },
  );

  it.each([false, true])(
    "keeps full top-bar settings without a character when isSignedIn=%s",
    async (isSignedIn) => {
      renderInAudio(
        <SignedInIcons
          variant="default"
          isSignedIn={isSignedIn}
          updateUser={async () => undefined}
          onEventClick={() => {}}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Game settings" }));
      });
      expect(screen.getByLabelText(MUSIC)).toBeTruthy();
      expect(screen.queryByRole("link", { name: "All settings" })).toBeNull();
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Game layout" }), {
        button: 0,
      });
      expect(screen.getByLabelText(SIDEBARS)).toBeTruthy();
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Visual effects" }), {
        button: 0,
      });
      expect(screen.getByLabelText(LIGHTING)).toBeTruthy();
    },
  );

  it("keeps the full popover without a settings link elsewhere", async () => {
    renderInAudio(<GameSettingsPopover trigger="settings" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Game settings" }));
    });
    expect(screen.getByRole("tab", { name: "Game layout" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Visual effects" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "All settings" })).toBeNull();
  });
});

describe("tutorial reminder", () => {
  const userWith = (tutorialOn: boolean, questType: string, completed: number) =>
    ({
      tutorialOn,
      userQuests: [{ completed, quest: { questType } }],
    }) as unknown as NonNullable<UserWithRelations>;

  it("reminds only when the tutorial is off and starter or tier quests are open", () => {
    expect(hasTutorialReminder(userWith(false, "starter", 0))).toBe(true);
    expect(hasTutorialReminder(userWith(false, "tier", 0))).toBe(true);
    expect(hasTutorialReminder(userWith(true, "starter", 0))).toBe(false);
    expect(hasTutorialReminder(userWith(false, "starter", 1))).toBe(false);
    expect(hasTutorialReminder(userWith(false, "daily", 0))).toBe(false);
    expect(hasTutorialReminder(null)).toBe(false);
  });
});

describe("tutorial settings mutation", () => {
  const mockUser = (hasActiveQuest = false) => {
    const prepareUserUpdate = vi.fn(() => 7);
    const updateUser = vi.fn(async () => true);
    vi.spyOn(userContext, "useRequiredUserDataSelector").mockReturnValue({
      data: {
        tutorialOn: false,
        userQuests: hasActiveQuest
          ? [{ completed: 0, quest: { questType: "starter" } }]
          : [],
      },
      prepareUserUpdate,
      updateUser,
    } as never);
    return { prepareUserUpdate, updateUser };
  };

  it("keeps active quest guidance and help actions beneath the settings description", () => {
    mockUser(true);
    render(
      <section>
        <h2>Help &amp; tutorial</h2>
        <p>Tutorial mode, player guide, and support tickets</p>
        <TutorialSettings />
      </section>,
    );
    expect(screen.queryByText(/The tutorial helps new players/)).toBeNull();
    expect(screen.getByText("You have active quests!")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable Tutorial" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Player guide" }).getAttribute("href"),
    ).toBe("/guide");
    expect(
      screen.getByRole("link", { name: "Support tickets" }).getAttribute("href"),
    ).toBe("/support");
  });

  it("applies the successful server patch at the captured cache revision", async () => {
    const { prepareUserUpdate, updateUser } = mockUser();
    render(<TutorialSettings />);
    expect(preferenceCallbacks?.onMutate).toBe(prepareUserUpdate);
    const result = {
      success: true,
      message: "Updated preferences",
      userPatch: { tutorialOn: true },
    };
    await preferenceCallbacks?.onSuccess?.(
      result,
      { tutorialOn: true },
      7,
      {} as never,
    );
    expect(updateUser).toHaveBeenCalledWith(result, { revision: 7 });
  });

  it("shows rejected updates without accepting a profile patch", async () => {
    const { updateUser } = mockUser();
    const showToast = vi
      .spyOn(toast, "showMutationToast")
      .mockImplementation(() => undefined);
    render(<TutorialSettings />);
    const result = { success: false, message: "Failed to update preferences" };
    await preferenceCallbacks?.onSuccess?.(
      result,
      { tutorialOn: true },
      7,
      {} as never,
    );
    expect(showToast).toHaveBeenCalledWith(result);
    expect(updateUser).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Enable Tutorial" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
