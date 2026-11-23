import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { NPC_AI_PROFILE_MAX_RULES } from "@/drizzle/constants";
import AiProfileEdit from "@/layout/AiProfileEdit";
import * as ContentBox from "@/layout/ContentBox";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import {
  ActionEndTurn,
  ActionMoveTowardsOpponent,
  ActionSpecificCombo,
  ActionUseSpecificItem,
  ActionUseSpecificJutsu,
  AiRule,
  type AiRuleType,
  ConditionDistanceHigherThan,
  ConditionPlayerWithinRange,
  ConditionSpecificRound,
  getBackupRules,
} from "@/validators/ai";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { spyOnToasts } from "../setup/toastMock";
import { mockUserContextValue } from "../setup/userContext";

const mocks = {
  profile: { id: "custom", includeDefaultRules: true, rules: [] as AiRuleType[] },
  fetchProfile: vi.fn(),
  /** A profile id whose rules are still loading. */
  loadingId: "",
  toggle: vi.fn(),
  toggling: false,
  save: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  query: vi.fn(),
  role: "CONTENT-ADMIN",
};
const api = {
  useUtils: () => ({
    ai: { getAiProfile: { invalidate: mocks.invalidate, fetch: mocks.fetchProfile } },
    profile: {
      getAi: { invalidate: mocks.invalidate },
      getPublicUser: { invalidate: mocks.invalidate },
    },
  }),
  ai: {
    getAiProfile: {
      useQuery: (input: { id: string }, options: unknown) => {
        mocks.query(input, options);
        return input.id === mocks.loadingId
          ? { data: undefined, isPending: true }
          : { data: mocks.profile, isPending: false };
      },
    },
    toggleAiProfile: {
      useMutation: () => ({ mutate: mocks.toggle, isPending: mocks.toggling }),
    },
    updateAiProfile: { useMutation: () => ({ mutate: mocks.save, isPending: false }) },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), api);
  mockUserContextValue(() => ({ data: { role: mocks.role } }) as never);
  spyOnToasts();
  vi.spyOn(ContentBox, "default").mockImplementation((({
    children,
    topRightContent,
  }: {
    children: ReactNode;
    topRightContent?: ReactNode;
  }) => (
    <div>
      {topRightContent}
      {children}
    </div>
  )) as never);
  mocks.profile = {
    id: "custom",
    includeDefaultRules: true,
    rules: [{ conditions: [], action: ActionEndTurn.parse({}) }, ...getBackupRules()],
  };
  mocks.role = "CONTENT-ADMIN";
  mocks.loadingId = "";
  mocks.toggling = false;
});

describe("controlled companion AI configuration", () => {
  it("saves an intentionally empty controlled profile without restoring fallback instructions", () => {
    const onSave = vi.fn();
    const view = render(
      <AiProfileEdit
        userData={{ aiProfileId: null, userId: "species", jutsus: [], items: [] }}
        configuration={{
          profile: { rules: [], includeDefaultRules: false },
          isSaving: false,
          onSave,
        }}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
    expect(onSave).toHaveBeenCalledWith({ rules: [], includeDefaultRules: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves embedded rules without loading or mutating a player AI profile", () => {
    mocks.role = "USER";
    const onSave = vi.fn();
    const profile = {
      includeDefaultRules: false,
      rules: [{ conditions: [], action: ActionEndTurn.parse({}) }],
    };
    const view = render(
      <AiProfileEdit
        userData={{ aiProfileId: null, userId: "pet", jutsus: [], items: [] }}
        configuration={{ profile, isSaving: false, onSave }}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
    expect(mocks.query).toHaveBeenCalledWith({ id: "Default" }, { enabled: false });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ includeDefaultRules: false });
    expect(onSave.mock.lastCall?.[0].rules).toHaveLength(2);
  });

  it("keeps an edited draft when controlled saving or eligibility changes", () => {
    const onSave = vi.fn();
    const profile = { includeDefaultRules: true, rules: mocks.profile.rules };
    const component = (isSaving: boolean, disabled = false) => (
      <AiProfileEdit
        userData={{ aiProfileId: null, userId: "pet", jutsus: [], items: [] }}
        configuration={{ profile, isSaving, disabled, onSave }}
      />
    );
    const view = render(component(false));
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    view.rerender(component(true));
    expect(view.queryByRole("button", { name: "Save Profile" })).toBeNull();
    view.rerender(component(false, true));
    expect(view.queryByRole("button", { name: "Save Profile" })).toBeNull();
    view.rerender(component(false));
    fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
    expect(onSave.mock.lastCall?.[0].rules).toHaveLength(7);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const mount = () =>
  render(
    <AiProfileEdit
      userData={{ aiProfileId: "custom", userId: "editor", jutsus: [], items: [] }}
    />,
  );
const headers = (view: ReturnType<typeof mount>) =>
  view
    .getAllByRole("button")
    .filter((button) => /^(Rule|Fallback rule) \d+:/.test(button.textContent ?? ""));
const save = (view: ReturnType<typeof mount>) => {
  fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
  return mocks.save.mock.calls[0]?.[0] as { rules: AiRuleType[] };
};

/** Toasts announcing copied rules. */
const copiedToasts = () =>
  (
    toast.showMutationToast as unknown as { mock: { calls: [{ message: string }][] } }
  ).mock.calls.filter(([result]) => /^Copied the rules of/.test(result.message));

const custom = (count: number): AiRuleType[] =>
  Array.from({ length: count }, () =>
    AiRule.parse({ conditions: [], action: ActionEndTurn.parse({}) }),
  );

it("counts NPC fallback rules toward the total limit and stops adding at 50", () => {
  mocks.profile.rules = [
    ...custom(NPC_AI_PROFILE_MAX_RULES - getBackupRules().length - 1),
    ...getBackupRules(),
  ];
  const view = render(
    <AiProfileEdit
      userData={{ aiProfileId: "custom", userId: "bot", jutsus: [], items: [] }}
      maxTotalRules={NPC_AI_PROFILE_MAX_RULES}
    />,
  );
  expect(view.getByText("49 / 50 rules")).toBeDefined();
  fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
  expect(view.getByText("50 / 50 rules")).toBeDefined();
  expect(
    (view.getByRole("button", { name: "Add Rule" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Add Group" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(save(view).rules).toHaveLength(50);
});

it("rejects an NPC draft exceeding the total limit", () => {
  mocks.profile.rules = [
    ...custom(NPC_AI_PROFILE_MAX_RULES - getBackupRules().length + 1),
    ...getBackupRules(),
  ];
  const view = render(
    <AiProfileEdit
      userData={{ aiProfileId: "custom", userId: "bot", jutsus: [], items: [] }}
      maxTotalRules={NPC_AI_PROFILE_MAX_RULES}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(toast.showMutationToast).toHaveBeenCalledWith({
    success: false,
    message: "Maximum of 50 rules allowed",
  });
});

it("keeps the staff CatchAll switch off limits while the rules are locked", () => {
  const component = (locked: boolean) => (
    <AiProfileEdit
      userData={{ aiProfileId: "custom", userId: "bot", jutsus: [], items: [] }}
      locked={locked}
    />
  );
  const view = render(component(false));
  expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
  view.rerender(component(true));
  expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
});

describe("a player's rules for a jutsu loadout", () => {
  const player = (props: Partial<React.ComponentProps<typeof AiProfileEdit>> = {}) => {
    mocks.role = "USER";
    return render(
      <AiProfileEdit
        userData={{ aiProfileId: "custom", userId: "editor", jutsus: [], items: [] }}
        maxCustomRules={2}
        {...props}
      />,
    );
  };

  it("counts custom rules without the fallback rules and stops adding at the limit", () => {
    const view = player();
    expect(view.getByText("1 / 2 rules")).toBeDefined();
    expect(view.getAllByText(/^Fallback rule [1-5]:/)).toHaveLength(5);
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    expect(view.getByText("2 / 2 rules")).toBeDefined();
    expect(
      (view.getByRole("button", { name: "Add Rule" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (view.getByRole("button", { name: "Add Group" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      view.getByText("Rule limit reached. Delete a rule to add another."),
    ).toBeDefined();
  });

  it("does not report a rule value typed back to its saved number as an unsaved edit", () => {
    mocks.profile = {
      id: "custom",
      includeDefaultRules: true,
      rules: [
        AiRule.parse({
          conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
          action: ActionEndTurn.parse({}),
        }),
        ...getBackupRules(),
      ],
    };
    const onDirtyChange = vi.fn();
    const view = player({ onDirtyChange });
    fireEvent.click(headers(view)[0]!);
    const value = view.getByDisplayValue("2");
    fireEvent.change(value, { target: { value: "25" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(value, { target: { value: "2" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("locks the fallback rules' conditions and actions for players", () => {
    const view = player();
    const fallback = headers(view).find((header) =>
      header.textContent?.startsWith("Fallback rule 1:"),
    );
    fireEvent.click(fallback!);
    // Its "distance higher than 2" condition can't be changed.
    const value = view.getByDisplayValue("2") as HTMLInputElement;
    expect(value.disabled).toBe(true);
  });

  it("reports unsaved edits and discards them on request", () => {
    const onDirtyChange = vi.fn();
    const view = player({ onDirtyChange });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(view.getByRole("button", { name: "Discard changes" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(view.getByText("1 / 2 rules")).toBeDefined();
  });

  it("does not switch rules when the tab already shown is chosen again", () => {
    const view = player();
    fireEvent.click(view.getByRole("button", { name: "Custom" }));
    expect(mocks.toggle).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Default" }));
    expect(mocks.toggle).toHaveBeenCalledWith({ aiId: "editor", custom: false });
  });

  it("shows no counter or copying on the read-only Default rules", () => {
    const view = player({
      userData: { aiProfileId: null, userId: "editor", jutsus: [], items: [] },
      copySources: [{ id: "pvp", name: "PvP" }],
    });
    expect(view.queryByText(/ \/ 2 rules/)).toBeNull();
    expect(view.queryByRole("button", { name: "Copy rules from PvP" })).toBeNull();
  });

  it("asks before copying over unsaved edits, and keeps the draft when copying fails", async () => {
    installBrowserGlobals();
    mocks.fetchProfile.mockRejectedValue(new Error("offline"));
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    await waitFor(() => expect(mocks.fetchProfile).toHaveBeenCalledTimes(1));
    expect(view.getByText("1 / 2 rules")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    expect(mocks.fetchProfile).toHaveBeenCalledTimes(1);
    expect(
      view.getByText(/Replace your unsaved rules with the rules of PvP/),
    ).toBeDefined();
    cleanup();
    await flushRadixFocus();
    restoreBrowserGlobals();
  });

  it("keeps edits made while copied rules are still loading", async () => {
    let resolve: (profile: unknown) => void = () => undefined;
    mocks.fetchProfile.mockReturnValue(new Promise((done) => (resolve = done)));
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    await act(async () =>
      resolve({
        id: "pvp",
        includeDefaultRules: true,
        rules: [...getBackupRules()],
      }),
    );
    expect(view.getByText("2 / 2 rules")).toBeDefined();
    expect(copiedToasts()).toHaveLength(0);
  });

  it("drops copied rules that arrive after the player switched to other rules", async () => {
    let resolve: (profile: unknown) => void = () => undefined;
    mocks.fetchProfile.mockReturnValue(new Promise((done) => (resolve = done)));
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    // The other loadout's rules load as their own profile.
    mocks.profile = { ...mocks.profile, id: "elsewhere" };
    view.rerender(
      <AiProfileEdit
        userData={{ aiProfileId: "elsewhere", userId: "editor", jutsus: [], items: [] }}
        maxCustomRules={2}
        copySources={[{ id: "pvp", name: "PvP" }]}
      />,
    );
    await act(async () =>
      resolve({
        id: "pvp",
        includeDefaultRules: true,
        rules: [...custom(2), ...getBackupRules()],
      }),
    );
    expect(view.getByText("1 / 2 rules")).toBeDefined();
    expect(copiedToasts()).toHaveLength(0);
  });

  it("drops copied rules when the player switches to rules that are still loading", async () => {
    let resolve: (profile: unknown) => void = () => undefined;
    mocks.fetchProfile.mockReturnValue(new Promise((done) => (resolve = done)));
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    mocks.loadingId = "elsewhere";
    const switched = () => (
      <AiProfileEdit
        userData={{ aiProfileId: "elsewhere", userId: "editor", jutsus: [], items: [] }}
        maxCustomRules={2}
        copySources={[{ id: "pvp", name: "PvP" }]}
      />
    );
    view.rerender(switched());
    await act(async () =>
      resolve({
        id: "pvp",
        includeDefaultRules: true,
        rules: [...custom(2), ...getBackupRules()],
      }),
    );
    expect(copiedToasts()).toHaveLength(0);
    // The other loadout's own rules show once they load.
    mocks.loadingId = "";
    mocks.profile = { ...mocks.profile, id: "elsewhere" };
    view.rerender(switched());
    expect(view.getByText("1 / 2 rules")).toBeDefined();
  });

  it("replaces unsaved edits with copied rules once the player confirms", async () => {
    installBrowserGlobals();
    mocks.fetchProfile.mockResolvedValue({
      id: "pvp",
      includeDefaultRules: true,
      rules: [...custom(2), ...getBackupRules()],
    });
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    fireEvent.click(view.getAllByRole("button", { name: "Delete rule" })[0]!);
    fireEvent.click(view.getAllByRole("button", { name: "Delete rule" })[0]!);
    expect(view.getByText("0 / 2 rules")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    fireEvent.click(view.getByRole("button", { name: "Proceed" }));
    await waitFor(() => expect(copiedToasts()).toHaveLength(1));
    expect(view.getByText("2 / 2 rules")).toBeDefined();
    cleanup();
    await flushRadixFocus();
    restoreBrowserGlobals();
  });

  it("says the copy replaced unsaved edits when it matches the saved rules", async () => {
    installBrowserGlobals();
    mocks.fetchProfile.mockResolvedValue({ ...mocks.profile, id: "pvp" });
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    fireEvent.click(view.getByRole("button", { name: "Proceed" }));
    await waitFor(() =>
      expect(toast.showMutationToast).toHaveBeenCalledWith({
        success: true,
        message: "Copied the rules of PvP, which match your saved rules.",
      }),
    );
    expect(view.getByText("1 / 2 rules")).toBeDefined();
    cleanup();
    await flushRadixFocus();
    restoreBrowserGlobals();
  });

  const readOnly = (view: ReturnType<typeof player>) => {
    expect(view.queryByRole("button", { name: "Add Rule" })).toBeNull();
    expect(view.queryByRole("button", { name: "Copy rules from PvP" })).toBeNull();
    expect(view.queryByRole("button", { name: "Save Profile" })).toBeNull();
  };

  it("keeps the rules read-only while the Default or Custom choice switches", () => {
    mocks.toggling = true;
    readOnly(player({ copySources: [{ id: "pvp", name: "PvP" }] }));
  });

  it("keeps the rules read-only while the caller switches or resets them", () => {
    readOnly(player({ copySources: [{ id: "pvp", name: "PvP" }], locked: true }));
  });

  it("says how many rules name jutsu or items that are not equipped", () => {
    mocks.profile.rules = [
      AiRule.parse({
        conditions: [],
        action: ActionUseSpecificJutsu.parse({ jutsuId: "fire" }),
      }),
      ...getBackupRules(),
    ];
    const view = player();
    expect(
      view.getByText(
        "1 rule names jutsu or items you don't have equipped. Battles skip that rule, and a combo never gets past a missing step, until they're equipped again.",
      ),
    ).toBeDefined();
    cleanup();
    // The read-only Default rules are not the player's to fix.
    const onDefault = player({
      userData: { aiProfileId: null, userId: "editor", jutsus: [], items: [] },
    });
    expect(onDefault.queryByText(/don't have equipped/)).toBeNull();
  });

  it("tells the caller while the Default or Custom choice switches", () => {
    mocks.toggling = true;
    const onTogglingChange = vi.fn();
    player({ onTogglingChange });
    expect(onTogglingChange).toHaveBeenLastCalledWith(true);
  });

  it("holds Save while copied rules are still loading", () => {
    mocks.fetchProfile.mockReturnValue(new Promise(() => undefined));
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    const saveButton = () =>
      view.getByRole("button", { name: "Save Profile" }) as HTMLButtonElement;
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    expect(saveButton().disabled).toBe(true);
  });

  it("keeps the Default or Custom choice out of reach while the rules are locked", () => {
    const view = player({ locked: true });
    expect(view.queryByRole("button", { name: "Default" })).toBeNull();
    expect(view.queryByRole("button", { name: "Custom" })).toBeNull();
  });

  it("drops copied rules that arrive while the rules are locked", async () => {
    let resolve: (profile: unknown) => void = () => undefined;
    mocks.fetchProfile.mockReturnValue(new Promise((done) => (resolve = done)));
    const component = (locked: boolean) => (
      <AiProfileEdit
        userData={{ aiProfileId: "custom", userId: "editor", jutsus: [], items: [] }}
        maxCustomRules={2}
        copySources={[{ id: "pvp", name: "PvP" }]}
        locked={locked}
      />
    );
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    view.rerender(component(true));
    await act(async () =>
      resolve({
        id: "pvp",
        includeDefaultRules: true,
        rules: [...custom(2), ...getBackupRules()],
      }),
    );
    view.rerender(component(false));
    expect(view.getByText("1 / 2 rules")).toBeDefined();
    expect(copiedToasts()).toHaveLength(0);
  });

  it("says so when the copied rules are the rules already saved", async () => {
    mocks.fetchProfile.mockResolvedValue({ ...mocks.profile, id: "pvp" });
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    await waitFor(() =>
      expect(toast.showMutationToast).toHaveBeenCalledWith({
        success: true,
        message: "Your rules already match the rules of PvP.",
      }),
    );
    expect(copiedToasts()).toHaveLength(0);
  });

  it("copies another loadout's rules into the draft for saving", async () => {
    mocks.fetchProfile.mockResolvedValue({
      id: "pvp",
      includeDefaultRules: true,
      rules: [
        AiRule.parse({ conditions: [], action: ActionMoveTowardsOpponent.parse({}) }),
        AiRule.parse({ conditions: [], action: ActionEndTurn.parse({}) }),
        ...getBackupRules(),
      ],
    });
    const view = player({ copySources: [{ id: "pvp", name: "PvP" }] });
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    await waitFor(() => expect(view.getByText("2 / 2 rules")).toBeDefined());
    expect(mocks.fetchProfile).toHaveBeenCalledWith({ id: "pvp" });
    expect(copiedToasts()).toHaveLength(1);
    const rules = save(view).rules;
    expect(rules.slice(0, 2).map((rule) => rule.action.type)).toEqual([
      "move_towards_opponent",
      "end_turn",
    ]);
    expect(rules).toHaveLength(2 + getBackupRules().length);
  });
});

describe("AI profile rule organization", () => {
  it("inserts above the open custom rule and keeps its priority", () => {
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    const rules = save(view).rules;
    expect(rules[0]?.action.type).toBe("move_towards_opponent");
    expect(rules[1]?.action.type).toBe("end_turn");
    expect(headers(view)[0]?.getAttribute("aria-expanded")).toBe("true");
  });
  it("inserts at the top when nothing is selected", () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    expect(save(view).rules[0]?.action.type).toBe("move_towards_opponent");
  });
  it("inserts before protected catch-alls when a fallback is selected", () => {
    const view = mount();
    fireEvent.click(headers(view).at(-1)!);
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    const rules = save(view).rules;
    expect(rules).toHaveLength(7);
    expect(rules[1]?.action.type).toBe("move_towards_opponent");
    expect(
      rules.slice(-5).map(({ conditions, action }) => ({ conditions, action })),
    ).toEqual(getBackupRules());
    expect(view.getAllByRole("button", { name: "Delete rule" })).toHaveLength(2);
  });
  it("preserves the open rule when moving and does not open a collapsed rule", () => {
    mocks.profile.rules.unshift(
      { conditions: [], action: ActionEndTurn.parse({}) },
      { conditions: [], action: ActionEndTurn.parse({}) },
    );
    const view = mount();
    fireEvent.click(headers(view)[1]!);
    fireEvent.click(view.getAllByRole("button", { name: "Move rule up" })[1]!);
    expect(headers(view)[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(headers(view)[1]?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(view.getAllByRole("button", { name: "Move rule down" })[1]!);
    expect(headers(view)[0]?.getAttribute("aria-expanded")).toBe("true");
  });
  it("collapses and saves named groups without changing rule priority", () => {
    mocks.profile.rules[0]!.group = {
      id: "g",
      name: "Boss phase",
      note: "Below half health",
    };
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: /Boss phase/ }));
    expect(headers(view)).toHaveLength(5);
    fireEvent.click(view.getByRole("button", { name: /Boss phase/ }));
    fireEvent.click(headers(view)[0]!);
    fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
    const rules = save(view).rules;
    expect(rules[0]?.group).toEqual(rules[1]?.group);
    expect(rules[0]?.group?.name).toBe("Boss phase");
    expect(rules[0]?.group?.note).toBe("Below half health");
    expect(rules).toHaveLength(7);
  });
  it("creates a new group above the active rule", () => {
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    fireEvent.click(view.getByRole("button", { name: "Add Group" }));
    const rules = save(view).rules;
    expect(rules[0]?.group?.name).toBe("New group");
    expect(rules[1]?.action.type).toBe("end_turn");
  });
  it("removes a group label while retaining its rules", () => {
    mocks.profile.rules[0]!.group = { id: "g", name: "Phase", note: "Buff" };
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Remove label" }));
    const rules = save(view).rules;
    expect(rules[0]?.group).toBeUndefined();
    expect(rules[0]?.action.type).toBe("end_turn");
    expect(rules).toHaveLength(6);
  });
});

const changeCoordinate = (
  view: ReturnType<typeof mount>,
  name: string,
  value: string,
) => {
  const input = view.getByRole("spinbutton", { name });
  fireEvent.input(input, { target: { value } });
};

describe("AI rounds editor", () => {
  beforeEach(() => {
    mocks.profile.rules[0]!.conditions = [ConditionSpecificRound.parse({ value: [3] })];
  });

  it("preserves unfinished input and saves sorted unique rounds", () => {
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    const rounds = view.getByRole("textbox", { name: "Rounds" }) as HTMLInputElement;
    fireEvent.change(rounds, { target: { value: "5, " } });
    expect(rounds.value).toBe("5, ");
    expect(view.getByRole("alert")).toBeDefined();
    fireEvent.change(rounds, { target: { value: "5, 1, 3, 1" } });
    expect(save(view).rules[0]!.conditions[0]).toMatchObject({ value: [1, 3, 5] });
  });

  it.each(["", "0", "-1, 3", "1.5", "1,", "1,,3", "1, abc"])(
    "blocks saving invalid rounds %s and permits correction",
    (value) => {
      const view = mount();
      fireEvent.click(headers(view)[0]!);
      const rounds = view.getByRole("textbox", { name: "Rounds" });
      fireEvent.change(rounds, { target: { value } });
      expect(view.getByRole("alert").textContent).toContain(
        "positive whole round number",
      );
      fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
      expect(mocks.save).not.toHaveBeenCalled();
      fireEvent.change(rounds, { target: { value: "2, 4" } });
      expect(save(view).rules[0]!.conditions[0]).toMatchObject({ value: [2, 4] });
    },
  );

  it("loads existing scalar rules and discards round edits", () => {
    Object.assign(mocks.profile.rules[0]!.conditions[0]!, { value: 3 });
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    expect(
      (view.getByRole("textbox", { name: "Rounds" }) as HTMLInputElement).value,
    ).toBe("3");
    fireEvent.change(view.getByRole("textbox", { name: "Rounds" }), {
      target: { value: "2, 4" },
    });
    fireEvent.click(view.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(headers(view)[0]!);
    expect(
      (view.getByRole("textbox", { name: "Rounds" }) as HTMLInputElement).value,
    ).toBe("3");
    expect(save(view).rules[0]!.conditions[0]).toMatchObject({ value: [3] });
  });

  it("makes rounds read-only when the editor is locked", () => {
    const view = render(
      <AiProfileEdit
        userData={{ aiProfileId: "custom", userId: "editor", jutsus: [], items: [] }}
        locked
      />,
    );
    fireEvent.click(headers(view)[0]!);
    expect(
      (view.getByRole("textbox", { name: "Rounds" }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("copies round lists from another loadout", async () => {
    mocks.role = "USER";
    mocks.fetchProfile.mockResolvedValue({
      id: "pvp",
      includeDefaultRules: true,
      rules: [
        AiRule.parse({
          conditions: [ConditionSpecificRound.parse({ value: [1, 3, 5] })],
          action: ActionEndTurn.parse({}),
        }),
        ...getBackupRules(),
      ],
    });
    const view = render(
      <AiProfileEdit
        userData={{ aiProfileId: "custom", userId: "editor", jutsus: [], items: [] }}
        maxCustomRules={2}
        copySources={[{ id: "pvp", name: "PvP" }]}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Discard changes" })).toBeDefined(),
    );
    expect(save(view).rules[0]!.conditions[0]).toMatchObject({ value: [1, 3, 5] });
  });
});

describe("AI enmity rank editor", () => {
  it.each(["HIGHEST_ENMITY_OPPONENT", "LOWEST_ENMITY_OPPONENT"])(
    "loads an omitted rank as 1 and saves an edited %s rank",
    (target) => {
      mocks.profile.rules[0]!.action = ActionMoveTowardsOpponent.parse({ target });
      const view = mount();
      fireEvent.click(headers(view)[0]!);
      expect(
        (view.getByRole("spinbutton", { name: "Enmity rank" }) as HTMLInputElement)
          .value,
      ).toBe("1");
      changeCoordinate(view, "Enmity rank", "3");
      expect(save(view).rules[0]!.action).toMatchObject({ target, enmityRank: 3 });
    },
  );

  it("edits a condition rank independently from the action", () => {
    mocks.profile.rules[0]!.conditions = [
      ConditionDistanceHigherThan.parse({
        target: "LOWEST_ENMITY_OPPONENT",
        enmityRank: 2,
      }),
    ];
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    changeCoordinate(view, "Enmity rank", "3");
    expect(save(view).rules[0]!.conditions[0]).toMatchObject({ enmityRank: 3 });
    expect(save(view).rules[0]!.action).not.toHaveProperty("enmityRank");
  });

  it.each(["", "0", "-1", "1.5"])("blocks saving rank %s until corrected", (value) => {
    mocks.profile.rules[0]!.action = ActionMoveTowardsOpponent.parse({
      target: "HIGHEST_ENMITY_OPPONENT",
    });
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    changeCoordinate(view, "Enmity rank", value);
    expect(view.getByRole("alert").textContent).toContain("positive whole number");
    fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
    expect(mocks.save).not.toHaveBeenCalled();
    changeCoordinate(view, "Enmity rank", "2");
    expect(save(view).rules[0]!.action).toMatchObject({ enmityRank: 2 });
  });

  it("copies saved ranks from another loadout", async () => {
    mocks.role = "USER";
    mocks.fetchProfile.mockResolvedValue({
      id: "pvp",
      includeDefaultRules: true,
      rules: [
        AiRule.parse({
          conditions: [],
          action: ActionMoveTowardsOpponent.parse({
            target: "LOWEST_ENMITY_OPPONENT",
            enmityRank: 3,
          }),
        }),
        ...getBackupRules(),
      ],
    });
    const view = render(
      <AiProfileEdit
        userData={{ aiProfileId: "custom", userId: "editor", jutsus: [], items: [] }}
        copySources={[{ id: "pvp", name: "PvP" }]}
        maxCustomRules={2}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Copy rules from PvP" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Discard changes" })).toBeDefined(),
    );
    expect(save(view).rules[0]!.action).toMatchObject({ enmityRank: 3 });
  });
});

describe("AI coordinate editor", () => {
  beforeEach(() => {
    mocks.profile.rules[0]!.action = ActionMoveTowardsOpponent.parse({
      target: "COORDINATE",
      coordinates: { longitude: 0, latitude: 4 },
    });
  });
  it("loads and saves X/Y coordinates, including zero", () => {
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    expect(
      (view.getByRole("spinbutton", { name: "X (column)" }) as HTMLInputElement).value,
    ).toBe("0");
    changeCoordinate(view, "Y (row)", "7");
    expect(save(view).rules[0]!.action).toMatchObject({
      target: "COORDINATE",
      coordinates: { longitude: 0, latitude: 7 },
    });
  });
  it.each(["", "-1", "1.5"])(
    "shows validation and prevents saving invalid X=%s",
    (value) => {
      const view = mount();
      fireEvent.click(headers(view)[0]!);
      changeCoordinate(view, "X (column)", value);
      expect(view.getByRole("alert").textContent).toContain(
        "non-negative whole number",
      );
      fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
      expect(mocks.save).not.toHaveBeenCalled();
      changeCoordinate(view, "X (column)", "2");
      expect(save(view).rules[0]!.action).toMatchObject({
        coordinates: { longitude: 2, latitude: 4 },
      });
    },
  );
});

describe("AI action pickers", () => {
  beforeEach(() => {
    installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
    mocks.profile.rules[0]!.action = ActionUseSpecificJutsu.parse({ jutsuId: "fire" });
  });
  afterEach(async () => {
    await act(async () => {
      cleanup();
      await flushRadixFocus();
    });
    restoreBrowserGlobals();
  });
  const jutsus = [
    { jutsuId: "fire", jutsu: { name: "Fire Ball" } },
    { jutsuId: "water", jutsu: { name: "Water Wall" } },
  ];
  /** Open the first rule with the supplied selectable jutsu definitions. */
  const picker = (options = jutsus, comboActionNames?: Record<string, string>) => {
    const view = render(
      <AiProfileEdit
        userData={{
          aiProfileId: "custom",
          userId: "editor",
          jutsus: options,
          items: [],
        }}
        comboActionNames={comboActionNames}
      />,
    );
    fireEvent.click(headers(view)[0]!);
    return view;
  };
  it("searches names case-insensitively, selects a result and saves its ID", async () => {
    const view = picker();
    fireEvent.click(view.getByRole("combobox", { name: "Specific jutsu" }));
    fireEvent.change(view.getByPlaceholderText("Search jutsu..."), {
      target: { value: "WATER" },
    });
    await waitFor(() =>
      expect(view.queryByRole("option", { name: "Fire Ball" })).toBeNull(),
    );
    fireEvent.click(view.getByRole("option", { name: "Water Wall" }));
    expect(view.queryByPlaceholderText("Search jutsu...")).toBeNull();
    expect(
      view.getByRole("combobox", { name: "Specific jutsu" }).textContent,
    ).toContain("Water Wall");
    expect(save(view).rules[0]?.action).toMatchObject({ jutsuId: "water" });
  });
  it("names the focused jutsu search for assistive technology", async () => {
    const view = picker();
    fireEvent.click(view.getByRole("combobox", { name: "Specific jutsu" }));
    const search = view.getByRole("combobox", { name: "Search jutsu" });
    await waitFor(() => expect(document.activeElement).toBe(search));
  });
  it("shows an empty search and recovers when the query is cleared", async () => {
    const view = picker();
    fireEvent.click(view.getByRole("combobox", { name: "Specific jutsu" }));
    fireEvent.change(view.getByPlaceholderText("Search jutsu..."), {
      target: { value: "missing" },
    });
    await waitFor(() => expect(view.getByText("No jutsu found.")).toBeTruthy());
    fireEvent.change(view.getByPlaceholderText("Search jutsu..."), {
      target: { value: "" },
    });
    await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(2));
  });
  it("keeps unavailable saved IDs without adding them to the options", () => {
    const view = picker([jutsus[1]!]);
    expect(
      view.getByRole("combobox", { name: "Specific jutsu" }).textContent,
    ).toContain("Selected jutsu unavailable");
    fireEvent.click(view.getByRole("combobox", { name: "Specific jutsu" }));
    expect(view.getAllByRole("option")).toHaveLength(1);
    expect(view.queryByRole("option", { name: "Fire Ball" })).toBeNull();
    expect(save(view).rules[0]?.action).toMatchObject({ jutsuId: "fire" });
  });
  it("names a saved jutsu the loadout does not equip", () => {
    const view = picker([jutsus[1]!], { fire: "Fire Ball" });
    expect(
      view.getByRole("combobox", { name: "Specific jutsu" }).textContent,
    ).toContain("Not equipped: Fire Ball");
  });
  it("names a saved item that is not equipped", () => {
    mocks.profile.rules[0]!.action = ActionUseSpecificItem.parse({ itemId: "pill" });
    const view = picker(jutsus, { pill: "Chakra Pill" });
    expect(view.getByRole("combobox", { name: "Specific item" }).textContent).toContain(
      "Not equipped: Chakra Pill",
    );
  });
  it("deduplicates owned copies and handles an empty loadout", () => {
    const view = picker([jutsus[0]!, jutsus[0]!]);
    fireEvent.click(view.getByRole("combobox", { name: "Specific jutsu" }));
    expect(view.getAllByRole("option")).toHaveLength(1);
    cleanup();
    const empty = picker([]);
    fireEvent.click(empty.getByRole("combobox", { name: "Specific jutsu" }));
    expect(empty.getByText("No jutsu found.")).toBeTruthy();
  });
  /** Exercise label fallbacks with available, untagged, and unknown saved references. */
  const comboPicker = () => {
    mocks.profile.rules[0]!.action = ActionSpecificCombo.parse({
      comboIds: ["fire", "pill", "missing", "water"],
    });
    const view = render(
      <AiProfileEdit
        userData={{
          aiProfileId: "custom",
          userId: "editor",
          jutsus: [jutsus[1]!],
          items: [],
        }}
        comboActionNames={{
          fire: "Fire Ball",
          pill: "Chakra Pill",
          water: "Water Wall",
        }}
      />,
    );
    fireEvent.click(headers(view)[0]!);
    return view;
  };
  it("names unavailable combo selections without offering them or discarding saved IDs", () => {
    const view = comboPicker();
    expect(
      view.getByRole("button", { name: "Remove Not equipped: Fire Ball" }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Remove Not equipped: Chakra Pill" }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Remove Unavailable action" }),
    ).toBeTruthy();
    expect(view.queryByText("missing")).toBeNull();
    fireEvent.click(
      view
        .getAllByRole("combobox")
        .find((element) => element.textContent?.includes("Water Wall"))!,
    );
    expect(view.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Water Wall",
    ]);
    expect(save(view).rules[0]?.action).toMatchObject({
      comboIds: ["fire", "pill", "missing", "water"],
    });
  });
  it("removes unavailable combo actions only when requested", () => {
    const view = comboPicker();
    fireEvent.click(
      view.getByRole("button", { name: "Remove Not equipped: Fire Ball" }),
    );
    expect(save(view).rules[0]?.action).toMatchObject({
      comboIds: ["pill", "missing", "water"],
    });
  });
  it.each([false, true])(
    "retains supplied combo choices for staff and companion editors (controlled=%s)",
    (controlled) => {
      mocks.role = controlled ? "USER" : "CONTENT-ADMIN";
      mocks.profile.rules[0]!.action = ActionSpecificCombo.parse({
        comboIds: ["fire"],
      });
      const onSave = vi.fn();
      const view = render(
        <AiProfileEdit
          userData={{ aiProfileId: "custom", userId: "editor", jutsus, items: [] }}
          configuration={
            controlled ? { profile: mocks.profile, isSaving: false, onSave } : undefined
          }
        />,
      );
      fireEvent.click(headers(view)[0]!);
      expect(view.getByRole("button", { name: "Remove Fire Ball" })).toBeTruthy();
      fireEvent.click(
        view
          .getAllByRole("combobox")
          .find((element) => element.textContent?.includes("Fire Ball"))!,
      );
      expect(view.getAllByRole("option")).toHaveLength(2);
      fireEvent.click(view.getByRole("option", { name: "Water Wall" }));
      fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
      expect(
        (controlled ? onSave : mocks.save).mock.lastCall?.[0].rules[0]?.action,
      ).toMatchObject({ comboIds: ["fire", "water"] });
    },
  );
});

describe("AI rule conditions and order", () => {
  it("edits and removes a rule's conditions", () => {
    mocks.profile.rules[0]!.conditions = [
      ConditionDistanceHigherThan.parse({ value: 2 }),
      ConditionPlayerWithinRange.parse({ minRange: 0, maxRange: 3 }),
    ];
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    fireEvent.change(view.container.querySelector("#value")!, {
      target: { value: "5" },
    });
    fireEvent.input(view.getByRole("spinbutton", { name: "Minimum range" }), {
      target: { value: "1" },
    });
    expect(save(view).rules[0]?.conditions).toMatchObject([
      { type: "distance_higher_than", value: 5 },
      { type: "player_within_range", minRange: 1, maxRange: 3 },
    ]);
    mocks.save.mockClear();
    fireEvent.click(view.container.querySelector(".absolute.top-2.right-2")!);
    expect(save(view).rules[0]?.conditions).toMatchObject([
      { type: "player_within_range", minRange: 1, maxRange: 3 },
    ]);
  });
  it("swaps neighbouring custom rules and keeps the catch-alls last", () => {
    mocks.profile.rules.splice(1, 0, {
      conditions: [],
      action: ActionMoveTowardsOpponent.parse({}),
    });
    const view = mount();
    const order = () =>
      save(view)
        .rules.slice(0, 2)
        .map((rule) => rule.action.type);
    expect(view.getAllByRole("button", { name: "Move rule up" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Move rule down" })).toHaveLength(1);
    fireEvent.click(view.getAllByRole("button", { name: "Move rule up" })[0]!);
    expect(order()).toEqual(["end_turn", "move_towards_opponent"]);
    mocks.save.mockClear();
    fireEvent.click(view.getByRole("button", { name: "Move rule down" }));
    expect(order()).toEqual(["move_towards_opponent", "end_turn"]);
    mocks.save.mockClear();
    fireEvent.click(view.getAllByRole("button", { name: "Move rule up" })[1]!);
    expect(order()).toEqual(["end_turn", "move_towards_opponent"]);
    expect(
      save(view)
        .rules.slice(-5)
        .map(({ conditions, action }) => ({ conditions, action })),
    ).toEqual(getBackupRules());
  });
});
