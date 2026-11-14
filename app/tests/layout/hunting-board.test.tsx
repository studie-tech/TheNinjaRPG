import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import * as navigation from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import * as combatEntry from "@/hooks/combatEntry";
import * as ContentBox from "@/layout/ContentBox";
import { HuntingArrival } from "@/layout/HuntingArrival";
import { HuntingBoard } from "@/layout/HuntingBoard";
import * as Modal from "@/layout/Modal";
import { AUTO_WAKE_MESSAGE, actionStatusMessage } from "@/libs/actionReadiness";
import * as toast from "@/libs/toast";
import { optimisticGlobalTravelStart } from "@/libs/travel";
import { pushToCombat } from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";
import { huntingContract, huntingHabitatContent } from "../setup/hunting";
import { mockUserContextValue } from "../setup/userContext";

const now = new Date();
const session = {
  content: huntingHabitatContent(),
  id: "session",
  habitatId: "forest",
  contractId: "contract",
  sector: 1,
  readyAt: null,
  battleId: null,
  version: 0,
};
let user: {
  userId: string;
  occupation: string;
  sector: number;
  status: string;
  huntingExperience?: number;
};
let currentSession: typeof session | null;
let boardSession: typeof session | null;
let boardProgress: { contractId: string; used: number; cooldownUntil: Date | null }[];
let respond: (result: UserDeltaResponse) => Promise<void>;
const updateUser = vi.fn(async () => undefined);

beforeEach(() => {
  vi.spyOn(combatEntry, "useCombatEntry").mockReturnValue({
    prepareCombatEntry: vi.fn(),
    loadBattle: vi.fn(),
  });
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation((select) => {
    const info = UserContext.useRequiredUserData();
    return { ...info, data: info.data ? select(info.data) : undefined } as never;
  });
});

beforeEach(() => {
  window.sessionStorage.removeItem("huntingArrival:hunter");
  window.sessionStorage.removeItem("huntingArrival:another-hunter");
  user = { userId: "hunter", occupation: "HUNTER", sector: 2, status: "AWAKE" };
  currentSession = null;
  boardSession = null;
  boardProgress = [];
  const board = {
    user: { ...user, huntingExperience: 123 },
    session: null,
    progress: [],
    serverTime: now,
    habitats: [
      { id: "forest", content: huntingHabitatContent() },
      {
        id: "desert",
        content: {
          ...huntingHabitatContent(),
          name: "Desert",
          contracts: [
            {
              ...huntingContract(),
              id: "lizard",
              name: "Lizard hunt",
              aiId: "lizard",
              rank: "C RANK",
              rewards: [{ itemId: "scales", quantity: 1, chance: 100 }],
            },
          ],
        },
      },
    ],
    creatures: [
      { userId: "enemy", username: "Boar", level: 10 },
      { userId: "lizard", username: "Lizard", level: 20 },
    ],
    materials: [
      { id: "hide", name: "Boar hide" },
      { id: "scales", name: "Lizard scales" },
    ],
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    hunting: {
      getBoard: {
        useQuery: () => ({
          data: {
            ...board,
            user: { ...board.user, ...user },
            session: boardSession,
            progress: boardProgress,
          },
          isLoading: false,
        }),
      },
      getSession: {
        useQuery: () => ({
          data: currentSession
            ? { session: currentSession, contract: huntingContract() }
            : null,
        }),
      },
      accept: {
        useMutation: (options: {
          onSuccess: (
            result: UserDeltaResponse,
            variables: unknown,
            revision: number | undefined,
          ) => Promise<void>;
        }) => {
          const [isPending, setPending] = useState(false);
          respond = async (result) => {
            await options.onSuccess(result, undefined, 7);
            setPending(false);
          };
          return { isPending, mutate: () => setPending(true) };
        },
      },
      sessionAction: { useMutation: () => ({}) },
      start: { useMutation: () => ({}) },
    },
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  updateUser.mockClear();
  // Count this test's feedback independently of Bun's retained module mocks.
  vi.spyOn(toast, "showMutationToast")
    .mockImplementation(() => undefined)
    .mockClear();
  mockUserContextValue(() => ({ data: user, updateUser }));
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
  );
  vi.spyOn(Modal, "default").mockImplementation(
    ({
      isOpen,
      children,
      setIsOpen,
    }: {
      isOpen: boolean;
      children: ReactNode;
      setIsOpen: (open: boolean) => void;
    }) =>
      isOpen ? (
        <div role="dialog">
          <button onClick={() => setIsOpen(false)}>Dismiss</button>
          {children}
        </div>
      ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([false, true])(
  "offers one hospital shortcut after rejection with active session: %s",
  async (hasSession) => {
    user.status = "HOSPITALIZED";
    user.huntingExperience = 999999;
    boardSession = hasSession ? session : null;
    const view = render(<HuntingBoard />);
    fireEvent.click(
      view.getAllByRole("button", { name: /Accept contract|Switch contract/i })[0]!,
    );
    await act(() =>
      respond({ success: false, message: actionStatusMessage("HOSPITALIZED") }),
    );
    expect(view.getByText(actionStatusMessage("HOSPITALIZED"))).toBeTruthy();
    expect(
      view
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === "/hospital"),
    ).toHaveLength(1);
    expect(
      (
        view.getAllByRole("button", {
          name: /Accept contract|Switch contract/i,
        })[0] as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(toast.showMutationToast).not.toHaveBeenCalled();
  },
);

it("keeps ordinary hunting rejections inline and retains a merged recovery notice once", async () => {
  const view = render(<HuntingBoard />);
  fireEvent.click(view.getAllByRole("button", { name: "Accept contract" })[0]!);
  await act(() => respond({ success: false, message: "Not enough experience" }));
  expect(view.getByRole("status").textContent).toBe("Not enough experience");
  expect(view.queryByRole("link", { name: "Go to hospital" })).toBeNull();
  expect(updateUser).not.toHaveBeenCalled();
  expect(toast.showMutationToast).not.toHaveBeenCalled();
  fireEvent.click(view.getAllByRole("button", { name: "Accept contract" })[0]!);
  await act(() =>
    respond({
      success: false,
      message: `Not enough experience ${AUTO_WAKE_MESSAGE}`,
      actionNotice: AUTO_WAKE_MESSAGE,
    }),
  );
  expect(view.getByRole("status").textContent).toBe(
    `Not enough experience ${AUTO_WAKE_MESSAGE}`,
  );
  expect(view.queryByRole("link", { name: "Go to hospital" })).toBeNull();
  expect(
    (view.getAllByRole("button", { name: "Accept contract" })[0] as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(updateUser).toHaveBeenCalledWith(
    expect.objectContaining({ actionNotice: AUTO_WAKE_MESSAGE }),
    { revision: 7, refetch: false },
  );
  expect(toast.showMutationToast).toHaveBeenCalledTimes(1);
});

it("enters a started hunt once when the battle event already navigated", async () => {
  let options!: {
    onSuccess: (result: object, input: undefined, revision: number) => Promise<void>;
  };
  const invalidate = async () => undefined;
  Object.assign(client.api, {
    useUtils: () => ({
      hunting: { getBoard: { invalidate }, getSession: { invalidate } },
      combat: { getBattle: { invalidate } },
    }),
  });
  Object.assign(client.api.hunting.start, {
    useMutation: (mutationOptions: typeof options) => {
      options = mutationOptions;
      return {};
    },
  });
  render(<HuntingBoard />);
  const router = navigation.useRouter();
  pushToCombat(router, "hunt-battle");
  await options.onSuccess(
    { success: true, message: "Started", battleId: "hunt-battle" },
    undefined,
    1,
  );
  expect(router.push).toHaveBeenCalledTimes(1);
});

it("hides nonmatching habitats and combines rank, creature and material filters", () => {
  const view = render(<HuntingBoard />);
  expect(view.getByRole("heading", { name: "Forest" })).toBeTruthy();
  expect(view.getByRole("heading", { name: "Desert" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "C RANK" }));
  expect(view.queryByRole("heading", { name: "Forest" })).toBeNull();
  expect(view.getByRole("heading", { name: "Lizard hunt" })).toBeTruthy();
  fireEvent.change(view.getByLabelText("Material filter"), {
    target: { value: "  SCALES  " },
  });
  expect(view.getByRole("heading", { name: "Desert" })).toBeTruthy();
  fireEvent.change(view.getByLabelText("Creature filter"), {
    target: { value: "boar" },
  });
  expect(view.queryByRole("heading", { name: "Desert" })).toBeNull();
  expect(view.getAllByText("No contracts match these filters.")).toHaveLength(1);
  fireEvent.click(view.getByRole("button", { name: "All ranks" }));
  fireEvent.change(view.getByLabelText("Material filter"), { target: { value: "" } });
  expect(view.getByRole("heading", { name: "Forest" })).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Desert" })).toBeNull();
});

it("renders accepted terms independently of the updated contract board", () => {
  boardSession = {
    ...session,
    content: {
      ...huntingHabitatContent(),
      name: "Accepted forest",
      contracts: [
        {
          ...huntingContract(),
          name: "Original boar",
          hunts: 7,
          preparationSeconds: 15,
          experience: 80,
          cooldownSeconds: 120,
          aiId: "lizard",
          rank: "C RANK",
          rewards: [{ itemId: "scales", quantity: 3, chance: 100 }],
        },
      ],
    },
  };
  boardProgress = [{ contractId: "contract", used: 1, cooldownUntil: null }];
  user.sector = 1;
  const view = render(<HuntingBoard />);
  expect(view.getAllByRole("heading", { name: "Original boar" })).toHaveLength(2);
  expect(view.getByText("6 / 7 successful hunts remaining")).toBeTruthy();
  expect(view.getByRole("button", { name: "Prepare (15s)" })).toBeTruthy();
  const activeRow = within(
    view.getByRole("button", { name: "Active contract" }).closest("article")!,
  );
  expect(activeRow.getByText("Guaranteed: 3× Lizard scales")).toBeTruthy();
  expect(activeRow.getByText("Lizard · Level 20 · C RANK · Easy")).toBeTruthy();
  expect(activeRow.getByText("+80 hunting experience · 15s preparation")).toBeTruthy();
  expect(
    activeRow.getByText("6 / 7 hunts · Cooldown after final victory: 120s"),
  ).toBeTruthy();
  expect(view.getByRole("heading", { name: "Lizard hunt" })).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "C RANK" }));
  fireEvent.change(view.getByLabelText("Creature filter"), {
    target: { value: "original boar" },
  });
  fireEvent.change(view.getByLabelText("Material filter"), {
    target: { value: "scales" },
  });
  expect(view.getByRole("button", { name: "Active contract" })).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "All ranks" }));
  fireEvent.change(view.getByLabelText("Creature filter"), { target: { value: "" } });
  fireEvent.change(view.getByLabelText("Material filter"), { target: { value: "" } });
  boardSession = null;
  view.rerender(<HuntingBoard />);
  expect(view.queryByRole("heading", { name: "Original boar" })).toBeNull();
  expect(view.getByRole("heading", { name: "Forest boar" })).toBeTruthy();
  expect(view.getAllByRole("button", { name: "Accept contract" })).toHaveLength(2);
  boardSession = session;
  view.rerender(<HuntingBoard />);
  const acceptedRow = within(
    view.getByRole("button", { name: "Active contract" }).closest("article")!,
  );
  expect(acceptedRow.getByText("Guaranteed: 2× Boar hide")).toBeTruthy();
  expect(
    acceptedRow.getByText("+50 hunting experience · 10s preparation"),
  ).toBeTruthy();
  expect(
    acceptedRow.getByText("2 / 3 hunts · Cooldown after final victory: 60s"),
  ).toBeTruthy();
});

it("opens on arrival, stays dismissed across refreshes, and reopens on the next arrival", () => {
  currentSession = session;
  const view = render(<HuntingArrival />);
  expect(view.queryByRole("dialog")).toBeNull();
  user = { ...user, sector: 1 };
  view.rerender(<HuntingArrival />);
  expect(view.getByRole("dialog")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
  view.rerender(<HuntingArrival />);
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Open hunting contract" }));
  expect(view.getByRole("dialog")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
  user = { ...user, sector: 2 };
  view.rerender(<HuntingArrival />);
  user = { ...user, sector: 1, status: "TRAVEL" };
  view.rerender(<HuntingArrival />);
  expect(view.queryByRole("dialog")).toBeNull();
  user = { ...user, status: "AWAKE" };
  view.rerender(<HuntingArrival />);
  expect(view.getByRole("dialog")).toBeTruthy();
  currentSession = null;
  view.rerender(<HuntingArrival />);
  expect(view.queryByRole("dialog")).toBeNull();
});

it("preserves dismissal across remounts, loading and same-sector combat", () => {
  currentSession = session;
  user = { ...user, sector: 1 };
  const first = render(<HuntingArrival />);
  fireEvent.click(first.getByRole("button", { name: "Dismiss" }));
  first.unmount();
  currentSession = null;
  const view = render(<HuntingArrival />);
  currentSession = session;
  view.rerender(<HuntingArrival />);
  expect(view.queryByRole("dialog")).toBeNull();
  user = { ...user, status: "BATTLE" };
  view.rerender(<HuntingArrival />);
  user = { ...user, status: "AWAKE" };
  view.rerender(<HuntingArrival />);
  expect(view.queryByRole("dialog")).toBeNull();
  user = { ...user, userId: "another-hunter" };
  view.rerender(<HuntingArrival />);
  expect(view.getByRole("dialog")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
  user = { ...user, userId: "hunter" };
  view.rerender(<HuntingArrival />);
  expect(view.queryByRole("dialog")).toBeNull();
});

it.each([
  { outcome: "is rejected", travelSeconds: 12, isLoading: false },
  { outcome: "fails with a network error", travelSeconds: 0, isLoading: true },
])(
  "preserves dismissal when optimistic travel $outcome",
  ({ travelSeconds, isLoading }) => {
    currentSession = session;
    user = { ...user, sector: session.sector };
    const view = render(<HuntingArrival />);
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    const savedDismissal = window.sessionStorage.getItem("huntingArrival:hunter");

    // startGlobalMove retains the sector until admission succeeds. Both rejection
    // and onError restore the previous status without changing the sector.
    const previousStatus = user.status;
    if (isLoading) currentSession = null;
    user = { ...user, ...optimisticGlobalTravelStart(travelSeconds) };
    view.rerender(<HuntingArrival />);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(window.sessionStorage.getItem("huntingArrival:hunter")).toBe(savedDismissal);
    user = { ...user, status: previousStatus };
    view.rerender(<HuntingArrival />);
    currentSession = session;
    view.rerender(<HuntingArrival />);
    expect(view.queryByRole("dialog")).toBeNull();
    view.unmount();
    expect(render(<HuntingArrival />).queryByRole("dialog")).toBeNull();
  },
);

it.each([0, 12])(
  "resets dismissal on confirmed departure with a %i-second trip while the session loads",
  (travelSeconds) => {
    currentSession = session;
    user = { ...user, sector: session.sector };
    const first = render(<HuntingArrival />);
    fireEvent.click(first.getByRole("button", { name: "Dismiss" }));
    first.unmount();
    currentSession = null;
    const departing = render(<HuntingArrival />);
    user = { ...user, ...optimisticGlobalTravelStart(travelSeconds) };
    departing.rerender(<HuntingArrival />);
    // Successful admission supplies the destination sector before travel finishes.
    user = { ...user, sector: 2 };
    departing.rerender(<HuntingArrival />);
    expect(window.sessionStorage.getItem("huntingArrival:hunter")).toBe("");
    departing.unmount();
    const view = render(<HuntingArrival />);
    user = { ...user, sector: session.sector };
    view.rerender(<HuntingArrival />);
    user = { ...user, status: "AWAKE" };
    view.rerender(<HuntingArrival />);
    currentSession = session;
    view.rerender(<HuntingArrival />);
    expect(view.getByRole("dialog")).toBeTruthy();
  },
);
