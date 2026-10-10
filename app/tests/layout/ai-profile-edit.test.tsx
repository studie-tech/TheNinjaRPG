import { ensureDom } from "../setup-dom.mjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import AiProfileEdit from "@/layout/AiProfileEdit";
import { ActionMoveTowardsOpponent, ActionEndTurn, getBackupRules, type AiRuleType } from "@/validators/ai";

const mocks = {
  profile: { id: "custom", includeDefaultRules: true, rules: [] as AiRuleType[] },
  save: vi.fn(),
  invalidate: vi.fn(async () => undefined),
};
vi.mock("@/app/_trpc/client", () => ({
  api: {
    useUtils: () => ({ ai: { getAiProfile: { invalidate: mocks.invalidate } }, profile: { getAi: { invalidate: mocks.invalidate }, getPublicUser: { invalidate: mocks.invalidate } } }),
    ai: {
      getAiProfile: { useQuery: () => ({ data: mocks.profile, isPending: false }) },
      toggleAiProfile: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateAiProfile: { useMutation: () => ({ mutate: mocks.save, isPending: false }) },
    },
  },
}));
vi.mock("@/utils/UserContext", () => ({ useRequiredUserData: () => ({ data: { role: "CONTENT-ADMIN" } }) }));
vi.mock("@/libs/toast", () => ({ showMutationToast: vi.fn() }));
vi.mock("@/layout/ContentBox", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  mocks.profile = { id: "custom", includeDefaultRules: true, rules: [{ conditions: [], action: ActionEndTurn.parse({}) }, ...getBackupRules()] };
});
afterEach(cleanup);
const mount = () => render(<AiProfileEdit userData={{ aiProfileId: "custom", userId: "editor", jutsus: [], items: [] }} />);
const headers = (view: ReturnType<typeof mount>) => view.getAllByRole("button").filter((button) => /^Rule \d+:/.test(button.textContent ?? ""));
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
    expect(rules.slice(-5).map(({ conditions, action }) => ({ conditions, action }))).toEqual(getBackupRules());
    expect(view.getAllByRole("button", { name: "Delete rule" })).toHaveLength(2);
  });
  it("preserves the open rule when moving and does not open a collapsed rule", () => {
    mocks.profile.rules.unshift({ conditions: [], action: ActionEndTurn.parse({}) }, { conditions: [], action: ActionEndTurn.parse({}) });
    const view = mount();
    fireEvent.click(headers(view)[1]!);
    fireEvent.click(view.getAllByRole("button", { name: "Move rule up" })[1]!);
    expect(headers(view)[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(headers(view)[1]?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(view.getAllByRole("button", { name: "Move rule down" })[1]!);
    expect(headers(view)[0]?.getAttribute("aria-expanded")).toBe("true");
  });
  it("collapses and saves named groups without changing rule priority", () => {
    mocks.profile.rules[0]!.group = { id: "g", name: "Boss phase", note: "Below half health" };
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


const changeCoordinate = (view: ReturnType<typeof mount>, name: string, value: string) => {
  const input = view.getByRole("spinbutton", { name });
  // The server preload imports react-dom before jsdom, enabling its legacy
  // change-event adapter. Supply the adapter methods on this input only.
  Object.assign(input, { attachEvent: () => undefined, detachEvent: () => undefined });
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "0" });
  fireEvent.focusOut(input);
};

describe("AI coordinate editor", () => {
  beforeEach(() => {
    mocks.profile.rules[0]!.action = ActionMoveTowardsOpponent.parse({ target: "COORDINATE", coordinates: { longitude: 0, latitude: 4 } });
  });
  it("loads and saves X/Y coordinates, including zero", () => {
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    expect((view.getByRole("spinbutton", { name: "X (column)" }) as HTMLInputElement).value).toBe("0");
    changeCoordinate(view, "Y (row)", "7");
    expect(save(view).rules[0]!.action).toMatchObject({ target: "COORDINATE", coordinates: { longitude: 0, latitude: 7 } });
  });
  it.each(["", "-1", "1.5"])("shows validation and prevents saving invalid X=%s", (value) => {
    const view = mount();
    fireEvent.click(headers(view)[0]!);
    changeCoordinate(view, "X (column)", value);
    expect(view.getByRole("alert").textContent).toContain("non-negative whole number");
    fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
    expect(mocks.save).not.toHaveBeenCalled();
    changeCoordinate(view, "X (column)", "2");
    expect(save(view).rules[0]!.action).toMatchObject({ coordinates: { longitude: 2, latitude: 4 } });
  });
});
