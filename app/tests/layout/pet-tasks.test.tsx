import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { PetTaskDispatch, PetTasks } from "@/layout/PetTasks";
import * as RewardChoice from "@/layout/RewardChoice";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

const testApi = createTRPCReact<AppRouter>();
let queryClient: QueryClient;
let owner: { userId: string; rank: string; status: string; level: number; occupation: string; activePetId: string; battleId: string | null; petTask: unknown; isBanned: boolean; isAi: boolean };
let task: RouterOutputs["quests"]["getPetTask"];
let start: ReturnType<typeof vi.fn>;
let collect: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let updateUser: ReturnType<typeof vi.fn>;
const receipt = { petId: "pet", questHistoryId: "attempt", questId: "contract", startedAt: 1000, questVersion: 500, finishesAt: Date.now() + 60_000 };
const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  ensureDom();
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event }, CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } },
  });
  updateUser = vi.fn().mockResolvedValue(undefined);
  owner = { userId: "owner", rank: "CHUNIN", status: "AWAKE", level: 30, occupation: "HUNTER", activePetId: "pet", battleId: null, petTask: null, isBanned: false, isAi: false };
  task = { task: null, petName: "Kumo", questName: "Contract", blockMessage: null, dispatchBlockMessage: null };
  start = vi.fn(() => ({ success: true, message: "Sent" }));
  collect = vi.fn(() => ({ success: true, message: "Returned" }));
  cancel = vi.fn(() => ({ success: true, message: "Returned without rewards" }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  Object.assign(vi.spyOn(client, "api" as never), { quests: testApi.quests, pets: testApi.pets, useUtils: testApi.useUtils });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(() => ({ data: owner, timeDiff: 0, prepareUserUpdate: () => 1, updateUser }) as never);
  vi.spyOn(RewardChoice, "useOpenRewardChoice").mockImplementation(() => vi.fn());
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(toast, "showRewardToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup(); queryClient.clear(); vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => { const descriptor = browserDescriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
});

const mount = (dispatch = false) => {
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    const respond = async () => {
      if (op.path === "quests.getPetTask") return task;
      if (op.path === "quests.specificQuests") return [{ id: "contract", name: "Hunt creature", questType: "hunting", petTaskMinutes: 30, entryRequirements: [] }, { id: "disabled", name: "Not delegated", questType: "hunting", petTaskMinutes: null, entryRequirements: [] }];
      if (op.path === "pets.getCollection") return { activePetId: "pet", pets: [{ id: "pet", name: "Kumo", rank: 5, artRank: 5, generationStatus: "READY", avatar: "/kumo.webp" }, { id: "too-young", name: "Cub", rank: 1, artRank: 1, generationStatus: "READY", avatar: "/cub.webp" }] };
      if (op.path === "quests.startPetTask") return start(op.input);
      if (op.path === "quests.collectPetTask") return collect(op.input);
      if (op.path === "quests.cancelPetTask") return cancel(op.input);
      throw new Error(`Unexpected procedure ${op.path}`);
    };
    void respond().then((data) => { observer.next({ result: { data } }); observer.complete(); }, (error) => observer.error(error));
  })] });
  return render(<testApi.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}>{dispatch ? <PetTaskDispatch questId="contract" questName="Hunt creature" minutes={30} entryRequirements={[]} /> : <PetTasks petId="pet" />}</QueryClientProvider></testApi.Provider>);
};

it("confirms the selected contract duration and final-only rewards before dispatch", async () => {
  const view = mount();
  await view.findByRole("combobox", { name: "Companion contract" });
  fireEvent.click(view.getAllByRole("button", { name: "Send companion" }).find((button) => button.tagName === "BUTTON")!);
  const dialog = await view.findByRole("dialog", { name: "Send your companion on Hunt creature?" });
  expect(dialog.textContent).toContain("30m");
  expect(dialog.textContent).toContain("Objectives and intermediate rewards are not simulated");
  fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith({ petId: "pet", questId: "contract" }));
});

it("preserves a rejected dispatch with visible feedback and a usable retry", async () => {
  start.mockReturnValue({ success: false, message: "This contract changed. Refresh and try again." });
  const view = mount();
  await view.findByRole("combobox", { name: "Companion contract" });
  fireEvent.click(view.getAllByRole("button", { name: "Send companion" }).find((button) => button.tagName === "BUTTON")!);
  const dialog = await view.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
  expect((await view.findByRole("alert")).textContent).toContain("This contract changed");
  await waitFor(() => expect((view.getAllByRole("button", { name: "Send companion" }).find((button) => button.tagName === "BUTTON") as HTMLButtonElement).disabled).toBe(false));
});

it("shows an existing task after a profession change and keeps early collection disabled", async () => {
  owner.occupation = "CRAFTING";
  owner.petTask = receipt;
  task = { ...task, task: receipt, blockMessage: "Your companion is still working on this task." };
  const view = mount();
  await view.findByText("Kumo: Contract");
  expect((view.getByRole("button", { name: "Collect results" }) as HTMLButtonElement).disabled).toBe(true);
  expect(view.getAllByRole("button", { name: "Return without rewards" }).length).toBeGreaterThan(0);
  expect(view.queryByRole("combobox")).toBeNull();
});

it("uses the displayed exact attempt when collecting ready results", async () => {
  const ready = { ...receipt, finishesAt: Date.now() - 1 };
  task = { ...task, task: ready };
  const view = mount();
  const button = await view.findByRole("button", { name: "Collect results" });
  fireEvent.click(button);
  await waitFor(() => expect(collect).toHaveBeenCalledWith(ready));
});

it("offers recovery for invalid content and confirms returning without rewards", async () => {
  task = { ...task, task: receipt, blockMessage: "This contract changed or is unavailable. Return your companion without rewards." };
  const view = mount();
  await view.findByText(/This contract changed or is unavailable/);
  expect((view.getByRole("button", { name: "Collect results" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getAllByRole("button", { name: "Return without rewards" }).find((button) => button.tagName === "BUTTON")!);
  const dialog = await view.findByRole("dialog", { name: "Return your companion without rewards?" });
  expect(dialog.textContent).toContain("Entry items already consumed");
  fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(receipt));
});

it("dispatches from the existing profession card using a ready eligible companion", async () => {
  const view = mount(true);
  const select = await view.findByRole("combobox", { name: "Companion for contract" });
  expect(select.textContent).toContain("Kumo");
  fireEvent.click(view.getAllByRole("button", { name: "Send companion" }).find((button) => button.tagName === "BUTTON")!);
  const dialog = await view.findByRole("dialog", { name: "Send Kumo on Hunt creature?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith({ petId: "pet", questId: "contract" }));
});

it("merges a cancelled receipt without deleting a restarted cached attempt", async () => {
  task = { ...task, task: receipt };
  cancel.mockReturnValue({ success: true, message: "Returned", userPatch: { petTask: null },
    closedAttempt: { id: receipt.questHistoryId, startedAt: receipt.startedAt } });
  const view = mount();
  await view.findAllByRole("button", { name: "Return without rewards" });
  fireEvent.click(view.getAllByRole("button", { name: "Return without rewards" }).find((button) => button.tagName === "BUTTON")!);
  const dialog = await view.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
  await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
  const [patch, options] = updateUser.mock.calls[0]!;
  const successor = { id: receipt.questHistoryId, startedAt: new Date(receipt.startedAt + 1) };
  expect(patch({ userQuests: [{ id: receipt.questHistoryId, startedAt: new Date(receipt.startedAt) }, successor] })).toEqual({ petTask: null, userQuests: [successor] });
  expect(options.revision).toBe(1);
});
