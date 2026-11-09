import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import AiProfileEdit from "@/layout/AiProfileEdit";
import * as ContentBox from "@/layout/ContentBox";
import * as userContext from "@/utils/UserContext";
import {
  ActionMoveTowardsOpponent,
  ActionEndTurn,
  ActionSpecificCombo,
  ActionUseSpecificJutsu,
  ConditionDistanceHigherThan,
  ConditionPlayerWithinRange,
  getBackupRules,
  type AiRuleType,
} from "@/validators/ai";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { spyOnToasts } from "../setup/toastMock";

const mocks = {
  profile: { id: "custom", includeDefaultRules: true, rules: [] as AiRuleType[] },
  save: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  query: vi.fn(),
  role: "CONTENT-ADMIN",
};
const api = {
  useUtils: () => ({
    ai: { getAiProfile: { invalidate: mocks.invalidate } },
    profile: {
      getAi: { invalidate: mocks.invalidate },
      getPublicUser: { invalidate: mocks.invalidate },
    },
  }),
  ai: {
    getAiProfile: {
      useQuery: (input: unknown, options: unknown) => {
        mocks.query(input, options);
        return { data: mocks.profile, isPending: false };
      },
    },
    toggleAiProfile: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    updateAiProfile: { useMutation: () => ({ mutate: mocks.save, isPending: false }) },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), api);
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () => ({ data: { role: mocks.role } }) as never,
  );
  spyOnToasts();
  vi.spyOn(ContentBox, "default").mockImplementation((({
    children,
  }: {
    children: ReactNode;
  }) => <div>{children}</div>) as never);
  mocks.profile = {
    id: "custom",
    includeDefaultRules: true,
    rules: [{ conditions: [], action: ActionEndTurn.parse({}) }, ...getBackupRules()],
  };
  mocks.role = "CONTENT-ADMIN";
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
    .filter((button) => /^Rule \d+:/.test(button.textContent ?? ""));
const save = (view: ReturnType<typeof mount>) => {
  fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
  return mocks.save.mock.calls[0]?.[0] as { rules: AiRuleType[] };
};

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
  const picker = (options = jutsus) => {
    const view = render(
      <AiProfileEdit
        userData={{
          aiProfileId: "custom",
          userId: "editor",
          jutsus: options,
          items: [],
        }}
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
      view.getByRole("button", { name: "Remove Fire Ball (unavailable)" }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Remove Chakra Pill (unavailable)" }),
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
      view.getByRole("button", { name: "Remove Fire Ball (unavailable)" }),
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
