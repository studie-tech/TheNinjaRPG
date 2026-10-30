import { QueryClient, QueryClientProvider, useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import DungeonEditor from "@/app/[shell]/manual/dungeon/page";
import { DUNGEON_FLOORS_PER_TIER } from "@/drizzle/constants";
import * as ContentBox from "@/layout/ContentBox";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";
import { dungeonContent } from "../setup/dungeon";

type SaveInput = RouterInputs["coop"]["dungeon"]["save"];
type SaveResult = RouterOutputs["coop"]["dungeon"]["save"];

// SearchSelect needs browser-native events, measurements and scrolling absent from the DOM shim.
const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const originalGlobals = browserGlobals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
});
afterEach(() => {
  cleanup();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks();
});

it.each(["success", "error"])("keeps the saved draft selected until a pending save settles with %s", async (outcome) => {
  ensureDom();
  const definitions = [
    { id: "A", content: { ...dungeonContent(), name: "Dungeon A" } },
    { id: "B", content: { ...dungeonContent(), name: "Dungeon B" } },
  ];
  let resolveSave!: (result: SaveResult) => void;
  let rejectSave!: (error: Error) => void;
  const save = vi.fn((_input: SaveInput) => new Promise<SaveResult>((resolve, reject) => {
    resolveSave = resolve;
    rejectSave = reject;
  }));
  const refetch = vi.fn(async () => undefined);
  const invalidate = vi.fn(async () => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ coop: { dungeon: { getAvailable: { invalidate } } } }),
    coop: { dungeon: {
      getAll: { useQuery: () => ({ data: definitions, refetch }) },
      save: { useMutation: (options: UseMutationOptions<SaveResult, Error, SaveInput>) => useMutation({ ...options, mutationFn: save }) },
    },
    },
    mapAsset: { getAll: { useQuery: () => ({ data: [] }) } },
    profile: { getAllAiNames: { useQuery: () => ({ data: [{ userId: "enemy", username: "Enemy" }] }) } },
    quests: { getAllNames: { useQuery: () => ({ data: [] }) } },
    item: { getAllNames: { useQuery: () => ({ data: [] }) } },
    jutsu: { getAllNames: { useQuery: () => ({ data: [] }) } },
    rewardPackages: { getCatalog: { useQuery: () => ({ data: { packages: [], nodes: [] } }) } },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }: { children: ReactNode }) => <div>{children}</div>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}><DungeonEditor /></QueryClientProvider>);
  const select = view.getByRole("combobox", { name: "Edit existing dungeon" }) as HTMLSelectElement;
  const newButton = view.getByRole("button", { name: "New dungeon" }) as HTMLButtonElement;
  fireEvent.change(select, { target: { value: "A" } });
  // A numeric draft on a hidden tab must be revealed and corrected before saving.
  const tokens = view.getByLabelText("Tokens") as HTMLInputElement;
  fireEvent.input(tokens, { target: { value: "" } });
  fireEvent.click(view.getByRole("button", { name: "Save dungeon" }));
  expect(save).not.toHaveBeenCalled();
  expect(view.getByRole("tab", { name: "Rewards" }).getAttribute("aria-selected")).toBe("true");
  expect(view.getByRole("status").textContent).toBe("Please correct the highlighted number.");
  fireEvent.input(tokens, { target: { value: "5" } });
  fireEvent.click(view.getByRole("button", { name: "Save dungeon" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0]).toMatchObject({ id: "A", content: { name: "Dungeon A" } });
  expect(select.disabled).toBe(true);
  expect(newButton.disabled).toBe(true);
  fireEvent.click(newButton);
  expect(select.value).toBe("A");
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Dungeon A");

  await act(async () => {
    if (outcome === "success") resolveSave({ success: true, message: "Dungeon saved.", id: "A" });
    else rejectSave(new Error("Save failed. Try again."));
  });
  await waitFor(() => expect(select.disabled).toBe(false));
  expect(newButton.disabled).toBe(false);
  expect(view.getByRole("status").textContent).toBe(outcome === "success" ? "Dungeon saved." : "Save failed. Try again.");
  expect(refetch).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
  expect(invalidate).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
  fireEvent.change(select, { target: { value: "B" } });
  fireEvent.click(view.getByRole("button", { name: "Save dungeon" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]?.[0]).toMatchObject({ id: "B", content: { name: "Dungeon B" } });
  await act(async () => { resolveSave({ success: true, message: "Dungeon saved.", id: "B" }); });
  await waitFor(() => expect(newButton.disabled).toBe(false));
  fireEvent.click(newButton);
  expect(select.value).toBe("");
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  fireEvent.change(view.getByLabelText("Name"), { target: { value: "New dungeon" } });
  fireEvent.click(view.getByRole("button", { name: "Save dungeon" }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(view.getByRole("tab", { name: "Encounters" }).getAttribute("aria-selected")).toBe("true");
  expect(view.getByRole("status").textContent).toContain("Tier 1, floor 1: Choose an enemy");
  queryClient.clear();
});

it.each(["", "11", "1.5"])("resets invalid enemy quantity %s for a new dungeon and saves the fresh draft", async (value) => {
  const save = vi.fn(async (_input: SaveInput): Promise<SaveResult> => ({ success: true, message: "Dungeon saved.", id: "A" }));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ coop: { dungeon: { getAvailable: { invalidate: async () => undefined } } } }),
    coop: { dungeon: {
      getAll: { useQuery: () => ({ data: [], refetch: async () => undefined }) },
      save: { useMutation: (options: UseMutationOptions<SaveResult, Error, SaveInput>) => useMutation({ ...options, mutationFn: save }) },
    } },
    mapAsset: { getAll: { useQuery: () => ({ data: [] }) } },
    profile: { getAllAiNames: { useQuery: () => ({ data: [{ userId: "enemy", username: "Enemy" }] }) } },
    quests: { getAllNames: { useQuery: () => ({ data: [] }) } },
    item: { getAllNames: { useQuery: () => ({ data: [] }) } },
    jutsu: { getAllNames: { useQuery: () => ({ data: [] }) } },
    rewardPackages: { getCatalog: { useQuery: () => ({ data: { packages: [], nodes: [] } }) } },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }: { children: ReactNode }) => <div>{children}</div>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}><DungeonEditor /></QueryClientProvider>);
  fireEvent.click(view.getByRole("tab", { name: "Encounters" }));
  fireEvent.input(view.getByLabelText("Wave 1 enemy 1 quantity"), { target: { value } });
  fireEvent.change(view.getByLabelText("Name"), { target: { value: "Discard me" } });
  fireEvent.input(view.getByLabelText("Tokens"), { target: { value: "" } });
  fireEvent.click(view.getByRole("button", { name: "New dungeon" }));
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  expect((view.getByLabelText("Tokens") as HTMLInputElement).value).toBe("0");
  expect(view.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(view.getByRole("tab", { name: "Encounters" }));
  const quantity = view.getByLabelText("Wave 1 enemy 1 quantity") as HTMLInputElement;
  expect(quantity.value).toBe("1");
  expect(quantity.checkValidity()).toBe(true);
  fireEvent.change(view.getByLabelText("Name"), { target: { value: "Fresh dungeon" } });
  for (let floor = 0; floor < DUNGEON_FLOORS_PER_TIER; floor++) {
    fireEvent.click(view.getByRole("button", { name: new RegExp(`^Floor ${floor + 1}`) }));
    fireEvent.click(view.getByRole("combobox", { name: "Wave 1 enemy 1" }));
    fireEvent.click(await view.findByRole("option", { name: "Enemy" }));
    expect(view.getByRole("combobox", { name: "Wave 1 enemy 1" }).textContent).toContain("Enemy");
    if (floor === 0) fireEvent.input(view.getByLabelText("Wave 1 enemy 1 quantity"), { target: { value: "2" } });
  }
  fireEvent.click(view.getByRole("button", { name: "Save dungeon" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0]).toMatchObject({ id: undefined, content: { name: "Fresh dungeon", rewards: { tokens: 0 } } });
  expect(save.mock.calls[0]![0].content.tiers[0]!.map((room) => room.waves[0]!.aiIds)).toEqual([
    ["enemy", "enemy"], ...Array.from({ length: DUNGEON_FLOORS_PER_TIER - 1 }, () => ["enemy"]),
  ]);
  await waitFor(() => expect(view.getByRole("status").textContent).toBe("Dungeon saved."));
  queryClient.clear();
});

it("searches enemies and rewards, preserves invalid quantity drafts, and saves grouped wave quantities", async () => {
  const content = dungeonContent();
  content.tiers[0]![0]!.waves[0]!.aiIds = ["enemy", "enemy"];
  content.tiers.push(structuredClone(content.tiers[0]!));
  content.tiers[0]!.at(-1)!.kind = "mini-boss";
  content.tiers[0]![0]!.waves.push({aiIds: ["enemy"], delayRounds: 1});
  const save = vi.fn(async (_input: SaveInput): Promise<SaveResult> => ({success: true, message: "Dungeon saved.", id: "A"}));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({coop: {dungeon: {getAvailable: {invalidate: async () => undefined}}}}),
    coop: {dungeon: {
      getAll: {useQuery: () => ({data: [{id: "A", content}], refetch: async () => undefined})},
      save: {useMutation: (options: UseMutationOptions<SaveResult, Error, SaveInput>) => useMutation({...options, mutationFn: save})},
    }},
    mapAsset: {getAll: {useQuery: () => ({data: []})}},
    profile: {getAllAiNames: {useQuery: () => ({data: [{userId: "enemy", username: "Enemy"}, {userId: "wolf", username: "Snow Wolf"}]})}},
    quests: { getAllNames: { useQuery: () => ({ data: [] }) } },
    item: {getAllNames: {useQuery: () => ({data: [{id: "cache", name: "Forest Cache", isCache: true}, {id: "herb", name: "Herb", isCache: false}]})}},
    jutsu: {getAllNames: {useQuery: () => ({data: [{id: "jutsu", name: "Fireball"}]})}},
    rewardPackages: {getCatalog: {useQuery: () => ({data: {packages: [{id: "bundle", name: "Starter Bundle"}], nodes: []}})}},
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }: { children: ReactNode }) => <div>{children}</div>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  const queryClient = new QueryClient({ defaultOptions: {mutations: {retry: false}} });
  const view = render(<QueryClientProvider client={queryClient}><DungeonEditor /></QueryClientProvider>);
  const selectReward = async (label: string, option: string) => {
    const selectedOption = await view.findByRole("option", {name: option});
    await act(async () => fireEvent.click(selectedOption));
    const trigger = view.getByRole("combobox", {name: label});
    expect(trigger.textContent).toContain(option);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Finish Radix's deferred focus restoration before opening another picker.
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  };
  fireEvent.change(view.getByRole("combobox", {name: "Edit existing dungeon"}), {target: {value: "A"}});
  fireEvent.click(view.getByRole("tab", {name: "Encounters"}));
  const quantity = view.getByLabelText("Wave 1 enemy 1 quantity") as HTMLInputElement;
  expect(quantity.value).toBe("2");
  for (const value of ["", "11", "1.5"]) {
    fireEvent.input(quantity, {target: {value}});
    expect(quantity.value).toBe(value);
    fireEvent.click(view.getByRole("button", {name: "Save dungeon"}));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", {name: "Floor 2"}));
    expect(view.getByText("Tier 1 · Floor 1")).toBeTruthy();
    fireEvent.change(view.getByRole("combobox", {name: "Tier"}), {target: {value: "1"}});
    expect((view.getByRole("combobox", {name: "Tier"}) as HTMLSelectElement).value).toBe("0");
    fireEvent.click(view.getByRole("button", {name: "Remove last tier"}));
    expect(view.getByRole("option", {name: "Tier 2 of 2"})).toBeTruthy();
    fireEvent.click(view.getByRole("combobox", {name: "Wave 1 enemy 1"}));
    fireEvent.click(await view.findByRole("option", {name: "Snow Wolf"}));
    expect(view.getByRole("combobox", {name: "Wave 1 enemy 1"}).textContent).toContain("Enemy");
    expect((view.getByLabelText("Wave 1 enemy 1 quantity") as HTMLInputElement).value).toBe(value);
    fireEvent.click(view.getByRole("button", {name: "Save dungeon"}));
    expect(save).not.toHaveBeenCalled();
  }
  fireEvent.input(quantity, {target: {value: "3"}});
  const laterQuantity = view.getByLabelText("Wave 2 enemy 1 quantity") as HTMLInputElement;
  fireEvent.input(laterQuantity, {target: {value: ""}});
  fireEvent.click(view.getByRole("button", {name: "Remove wave 1"}));
  expect(view.getByLabelText("Wave 2 enemy 1 quantity")).toBe(laterQuantity);
  expect(laterQuantity.value).toBe("");
  fireEvent.click(view.getByRole("button", {name: "Save dungeon"}));
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(laterQuantity, {target: {value: "1"}});
  fireEvent.click(view.getByRole("button", {name: "Remove wave 2"}));
  expect(view.queryByLabelText("Wave 2 enemy 1 quantity")).toBeNull();
  fireEvent.click(view.getByRole("button", {name: "Floor 2"}));
  expect(view.getByText("Tier 1 · Floor 2")).toBeTruthy();
  fireEvent.change(view.getByRole("combobox", {name: "Tier"}), {target: {value: "1"}});
  expect(view.getByText("Tier 2 · Floor 1")).toBeTruthy();
  fireEvent.click(view.getByRole("button", {name: "Remove last tier"}));
  expect(view.getByText("Tier 1 · Floor 1")).toBeTruthy();
  expect((view.getByLabelText("Wave 1 enemy 1 quantity") as HTMLInputElement).value).toBe("3");
  fireEvent.click(view.getByRole("combobox", {name: "Wave 1 enemy 1"}));
  fireEvent.change(view.getByRole("combobox", {name: "Search wave 1 enemy 1"}), {target: {value: "snow"}});
  expect(view.queryByRole("option", {name: "Enemy"})).toBeNull();
  fireEvent.click(await view.findByRole("option", {name: "Snow Wolf"}));
  fireEvent.click(view.getByRole("tab", {name: "Rewards"}));
  fireEvent.click(view.getByRole("button", {name: "Add random drop"}));
  fireEvent.change(view.getByLabelText("Drop 1 type"), {target: {value: "cache"}});
  fireEvent.click(view.getByRole("combobox", {name: "Drop 1 reward"}));
  expect(view.queryByRole("option", {name: "Herb"})).toBeNull();
  fireEvent.change(view.getByRole("combobox", {name: "Search drop 1 reward"}), {target: {value: "forest"}});
  await selectReward("Drop 1 reward", "Forest Cache");
  fireEvent.input(view.getByLabelText("Drop 1 quantity"), {target: {value: "4"}});
  fireEvent.click(view.getByRole("switch", {name: "Drop 1 only once per player"}));
  fireEvent.click(view.getByRole("button", {name: "Add random drop"}));
  fireEvent.change(view.getByLabelText("Drop 2 type"), {target: {value: "package"}});
  fireEvent.click(view.getByRole("combobox", {name: "Drop 2 reward"}));
  fireEvent.change(view.getByRole("combobox", {name: "Search drop 2 reward"}), {target: {value: "starter"}});
  await selectReward("Drop 2 reward", "Starter Bundle");
  fireEvent.input(view.getByLabelText("Drop 2 quantity"), {target: {value: "2"}});
  fireEvent.click(view.getByRole("button", {name: "Save dungeon"}));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0].content.tiers[0]![0]!.waves[0]!.aiIds).toEqual(["wolf", "wolf", "wolf"]);
  expect(save.mock.calls[0]![0].content.rewards.drops).toEqual([
    {type: "cache", id: "cache", chance: 100, quantity: 4, package: undefined, onlyOnce: true},
    {type: "package", id: "bundle", chance: 100, quantity: 2, package: undefined},
  ]);
  queryClient.clear();
});

it("saves displayed enemy quantities after making room in a full wave", async () => {
  const content = dungeonContent();
  content.tiers[0]![0]!.waves[0]!.aiIds = [...Array<string>(7).fill("enemy"), ...Array<string>(3).fill("wolf")];
  const save = vi.fn(async (_input: SaveInput): Promise<SaveResult> => ({ success: true, message: "Dungeon saved.", id: "A" }));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ coop: { dungeon: { getAvailable: { invalidate: async () => undefined } } } }),
    coop: { dungeon: {
      getAll: { useQuery: () => ({ data: [{ id: "A", content }], refetch: async () => undefined }) },
      save: { useMutation: (options: UseMutationOptions<SaveResult, Error, SaveInput>) => useMutation({ ...options, mutationFn: save }) },
    } },
    mapAsset: { getAll: { useQuery: () => ({ data: [] }) } },
    profile: { getAllAiNames: { useQuery: () => ({ data: [{ userId: "enemy", username: "Enemy" }, { userId: "wolf", username: "Snow Wolf" }] }) } },
    quests: { getAllNames: { useQuery: () => ({ data: [] }) } },
    item: { getAllNames: { useQuery: () => ({ data: [] }) } },
    jutsu: { getAllNames: { useQuery: () => ({ data: [] }) } },
    rewardPackages: { getCatalog: { useQuery: () => ({ data: { packages: [], nodes: [] } }) } },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }: { children: ReactNode }) => <div>{children}</div>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}><DungeonEditor /></QueryClientProvider>);
  fireEvent.change(view.getByRole("combobox", { name: "Edit existing dungeon" }), { target: { value: "A" } });
  fireEvent.click(view.getByRole("tab", { name: "Encounters" }));
  const quantity = view.getByLabelText("Wave 1 enemy 1 quantity") as HTMLInputElement;
  fireEvent.input(quantity, { target: { value: "9" } });
  expect(quantity.checkValidity()).toBe(true);
  expect(view.getByText("12 / 10 enemies in this wave")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Save dungeon" }));
  expect(save).not.toHaveBeenCalled();
  expect(view.getByRole("status").textContent).toContain("Tier 1, floor 1:");
  fireEvent.input(view.getByLabelText("Wave 1 enemy 2 quantity"), { target: { value: "1" } });
  expect(quantity.value).toBe("9");
  expect(quantity.checkValidity()).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Save dungeon" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0].content.tiers[0]![0]!.waves[0]!.aiIds).toEqual([...Array<string>(9).fill("enemy"), "wolf"]);
  queryClient.clear();
});
