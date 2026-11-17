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

beforeEach(() => {
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
    ai: { updateAiProfile: mutation },
    jutsu: { getLoadouts: { useQuery: () => ({ data: [] }) } },
  });
  mockUserContextValue(
    () =>
      ({
        data: {
          userId: "actor",
          showBattleDescription: false,
          showPvpRecord: false,
          primaryElement: "Fire",
        },
        updateUser: vi.fn(),
      }) as never,
  );
  vi.spyOn(combat, "useAutoCombatSetting").mockImplementation(() => [false, vi.fn()]);
  vi.spyOn(AiProfileEdit, "default").mockImplementation((({
    onDirtyChange,
  }: {
    onDirtyChange?: (isDirty: boolean) => void;
  }) => (
    <button type="button" onClick={() => onDirtyChange?.(true)}>
      AI profile editor
    </button>
  )) as never);
  vi.spyOn(loadoutCache, "useJutsuLoadoutCacheUpdate").mockReturnValue({
    prepareLoadoutUpdate: vi.fn(),
    updateEquippedLoadout: vi.fn(),
    updateLoadoutOrder: vi.fn(),
    updateToggledAiLoadout: vi.fn(),
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(JutsuLoadoutSelector, "default").mockImplementation((() => (
    <p>Jutsu loadout selector</p>
  )) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens on preferences and switches between the battle settings tabs", () => {
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
