import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as combat from "@/hooks/combat";
import * as AiProfileEdit from "@/layout/AiProfileEdit";
import { BattleSettingsEdit } from "@/layout/profileEdit/BattleSettingsEdit";
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
  vi.spyOn(AiProfileEdit, "default").mockImplementation(() => <p>AI profile editor</p>);
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
  fireEvent.mouseDown(view.getByRole("tab", { name: "Preferences" }));
  expect(view.getByText("Primary damage element")).toBeTruthy();
});
