import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as combat from "@/hooks/combat";
import * as loadoutCache from "@/hooks/useJutsuLoadoutCacheUpdate";
import * as AiProfileEdit from "@/layout/AiProfileEdit";
import * as JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import { BattleSettingsEdit } from "@/layout/profileEdit/BattleSettingsEdit";
import * as toast from "@/libs/toast";
import { mockUserContextValue } from "../setup/userContext";

/** Whether a "Reset rules" request is running. */
let resetting = false;

beforeEach(() => {
  resetting = false;
  const mutation = {
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: {
      getPublicUser: {
        useQuery: () => ({
          data: { aiProfileId: "ai", jutsus: [], items: [] },
          isPending: false,
        }),
      },
      updateBattleDescription: mutation,
      updatePreferences: mutation,
    },
    ai: {
      updateAiProfile: {
        useMutation: () => ({ mutate: vi.fn(), isPending: resetting }),
      },
    },
    jutsu: { getLoadouts: { useQuery: () => ({ data: [] }) } },
  });
  playerWithRules(null);
  vi.spyOn(combat, "useAutoCombatSetting").mockImplementation(() => [false, vi.fn()]);
  vi.spyOn(AiProfileEdit, "default").mockImplementation((({
    onDirtyChange,
    locked,
  }: {
    onDirtyChange?: (isDirty: boolean) => void;
    locked?: boolean;
  }) => (
    <button type="button" onClick={() => onDirtyChange?.(true)}>
      {locked ? "AI profile editor (locked)" : "AI profile editor"}
    </button>
  )) as never);
  vi.spyOn(loadoutCache, "useJutsuLoadoutCacheUpdate").mockReturnValue({
    prepareLoadoutUpdate: vi.fn(),
    updateEquippedLoadout: vi.fn(),
    updateLoadoutOrder: vi.fn(),
    updateToggledAiLoadout: vi.fn(),
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(JutsuLoadoutSelector, "default").mockImplementation((({
    onSelecting,
  }: {
    onSelecting?: (isSelecting: boolean) => void;
  }) => (
    <button type="button" onClick={() => onSelecting?.(true)}>
      Jutsu loadout selector
    </button>
  )) as never);
});

const playerWithRules = (aiProfileId: string | null) =>
  mockUserContextValue(
    () =>
      ({
        data: {
          userId: "actor",
          aiProfileId,
          showBattleDescription: false,
          showPvpRecord: false,
          primaryElement: "Fire",
        },
        updateUser: vi.fn(),
      }) as never,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens on preferences and switches between the battle settings tabs", () => {
  playerWithRules("ai");
  const view = render(<BattleSettingsEdit userId="actor" />);
  expect(view.getByRole("tab", { name: "Preferences", selected: true })).toBeTruthy();
  expect(view.getByText("Primary damage element")).toBeTruthy();
  fireEvent.mouseDown(view.getByRole("tab", { name: "Settings" }));
  expect(view.getByText("Show battle descriptions")).toBeTruthy();
  expect(view.queryByText("Primary damage element")).toBeNull();
  fireEvent.mouseDown(view.getByRole("tab", { name: "AI Profile" }));
  expect(view.getByText("AI profile editor")).toBeTruthy();
  // The rules belong to the active jutsu loadout, chosen right above them.
  expect(view.getByText("Jutsu loadout selector")).toBeTruthy();
  expect(
    view.getByText(/These rules belong to your active jutsu loadout/),
  ).toBeTruthy();
  fireEvent.mouseDown(view.getByRole("tab", { name: "Preferences" }));
  expect(view.getByText("Primary damage element")).toBeTruthy();
});

it("keeps the AI Profile tab open while its rules have unsaved edits", () => {
  const view = render(<BattleSettingsEdit userId="actor" />);
  fireEvent.mouseDown(view.getByRole("tab", { name: "AI Profile" }));
  // The editor reports an unsaved edit.
  fireEvent.click(view.getByText("AI profile editor"));
  fireEvent.mouseDown(view.getByRole("tab", { name: "Preferences" }));
  expect(view.getByRole("tab", { name: "AI Profile", selected: true })).toBeTruthy();
  expect(toast.showMutationToast).toHaveBeenCalledWith({
    success: false,
    message: "Save or discard your rule changes first",
  });
});

it("tells a player on the Default rules how to give the loadout its own", () => {
  const view = render(<BattleSettingsEdit userId="actor" />);
  fireEvent.mouseDown(view.getByRole("tab", { name: "AI Profile" }));
  expect(
    view.getByText(/Your active jutsu loadout fights with the Default rules/),
  ).toBeTruthy();
  expect(
    view.queryByText(/These rules belong to your active jutsu loadout/),
  ).toBeNull();
});

it("keeps the rules read-only while the loadout switches", () => {
  playerWithRules("ai");
  const view = render(<BattleSettingsEdit userId="actor" />);
  fireEvent.mouseDown(view.getByRole("tab", { name: "AI Profile" }));
  expect(view.getByText("AI profile editor")).toBeTruthy();
  fireEvent.click(view.getByText("Jutsu loadout selector"));
  expect(view.getByText("AI profile editor (locked)")).toBeTruthy();
});

it("keeps the rules read-only while they reset", () => {
  playerWithRules("ai");
  resetting = true;
  const view = render(<BattleSettingsEdit userId="actor" />);
  fireEvent.mouseDown(view.getByRole("tab", { name: "AI Profile" }));
  expect(view.getByText("AI profile editor (locked)")).toBeTruthy();
});

it("keeps Reset rules out of reach while the loadout switches", () => {
  playerWithRules("ai");
  const view = render(<BattleSettingsEdit userId="actor" />);
  fireEvent.mouseDown(view.getByRole("tab", { name: "AI Profile" }));
  const reset = () =>
    view.getByRole("button", { name: "Reset rules" }) as HTMLButtonElement;
  expect(reset().disabled).toBe(false);
  fireEvent.click(view.getByText("Jutsu loadout selector"));
  expect(reset().disabled).toBe(true);
});
