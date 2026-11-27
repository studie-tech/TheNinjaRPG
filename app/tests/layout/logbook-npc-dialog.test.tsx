import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as logbook from "@/layout/Logbook";
import * as Modal from "@/layout/Modal";
import { mockUserContextValue } from "../setup/userContext";

const procedure = {
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
};
/** Router whose procedures are idle, so the entry renders without a server. */
const router = (): unknown =>
  new Proxy(procedure, {
    get: (target, name) => target[name as keyof typeof procedure] ?? router(),
  });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => router(),
    gameAsset: router(),
    quests: router(),
  });
  vi.spyOn(logbook, "useCheckRewards").mockReturnValue({
    checkRewards: vi.fn(),
    isCheckingRewards: false,
  } as never);
  vi.spyOn(Modal, "default").mockImplementation((({
    isOpen,
    onAccept,
    proceed_label,
    children,
  }: {
    isOpen: boolean;
    onAccept?: (event: { preventDefault: () => void }) => void;
    proceed_label?: string;
    children: ReactNode;
  }) =>
    isOpen ? (
      <section>
        {children}
        <button type="button" onClick={(event) => onAccept?.(event)}>
          {proceed_label}
        </button>
      </section>
    ) : null) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Render a consecutive quest whose active step is a dialog, optionally bound to an NPC. */
const renderDialogStep = (overworldPlacementId?: string) => {
  mockUserContextValue({
    data: { userId: "viewer", role: "USER", status: "AWAKE", dailyMissions: 0 },
    prepareUserUpdate: () => 1,
    updateUser: vi.fn(),
  } as never);
  const quest = {
    id: "larry",
    name: "Overland",
    questType: "event",
    description: "",
    consecutiveObjectives: true,
    content: {
      objectives: [
        {
          id: "greet",
          task: "dialog",
          description: "Hello there",
          overworldPlacementId,
          nextObjectiveId: [{ text: "Tell me more", nextObjectiveId: "ask" }],
        },
      ],
      reward: {},
    },
  };
  return render(
    <logbook.LogbookEntry
      userQuest={
        {
          id: "larry",
          questId: "larry",
          quest,
          startedAt: new Date(0),
          completed: 0,
        } as never
      }
      tracker={{ id: "larry", goals: [] } as never}
      hideTitle
    />,
  );
};

describe("logbook dialog steps", () => {
  it("offers the choices of a dialog that is not bound to an NPC", () => {
    renderDialogStep();
    expect(screen.getByRole("button", { name: "Tell me more" })).toBeTruthy();
    expect(screen.queryByText(/continues in person/)).toBeNull();
  });

  it("shows what the dialog says beside its choices", () => {
    renderDialogStep();
    expect(screen.getByText("Hello there")).toBeTruthy();
  });

  it("does not give away what an NPC will say", () => {
    renderDialogStep("larry-placement");
    expect(screen.queryByText("Hello there")).toBeNull();
  });

  it("sends the player to the NPC for a dialog bound to an overworld placement", () => {
    renderDialogStep("larry-placement");
    expect(screen.queryByRole("button", { name: "Tell me more" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("continues in person");
  });
});

/** Render a quest whose player has answered three dialogs and reached a fourth. */
const renderLongConversation = (compact?: boolean) => {
  mockUserContextValue({
    data: { userId: "viewer", role: "USER", status: "AWAKE", dailyMissions: 0 },
    prepareUserUpdate: () => 1,
    updateUser: vi.fn(),
  } as never);
  const steps = ["first", "second", "third", "fourth"];
  const quest = {
    id: "saga",
    name: "Saga",
    questType: "event",
    description: "",
    consecutiveObjectives: true,
    content: {
      objectives: steps.map((id, i) => ({
        id,
        task: "dialog",
        description: `${id} words`,
        nextObjectiveId: [{ text: `After ${id}`, nextObjectiveId: steps[i + 1] }],
      })),
      reward: {},
    },
  };
  const goals = steps.slice(0, 3).map((id, i) => ({
    id,
    done: true,
    selectedNextObjectiveId: steps[i + 1],
  }));
  return render(
    <logbook.LogbookEntry
      userQuest={
        {
          id: "saga",
          questId: "saga",
          quest,
          startedAt: new Date(0),
          completed: 0,
        } as never
      }
      tracker={{ id: "saga", goals } as never}
      compact={compact}
      hideTitle
    />,
  );
};

describe("logbook earlier dialogue", () => {
  it("keeps earlier dialogue in a capped scroll area, newest first", () => {
    renderLongConversation();
    const region = screen.getByRole("region", { name: "Earlier dialogue (3)" });
    const toggle = screen.getByRole("button", { name: "Hide" });
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(region.contains(list)).toBe(true);
    expect(list?.getAttribute("tabindex")).toBe("0");
    expect(list?.className).toContain("max-h-96");
    expect(list?.className).toContain("overflow-y-auto");
    expect(list?.textContent).toMatch(/third words.*second words.*first words/);
    expect(
      screen.getByRole("region", { name: "Quest dialogue" }).textContent,
    ).toContain("fourth words");
  });

  it("lets the player fold earlier dialogue away and open it again", () => {
    renderLongConversation();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("first words")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("first words")).toBeTruthy();
  });

  it("starts folded in the compact dock", () => {
    renderLongConversation(true);
    expect(
      screen.getByRole("button", { name: "Show" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText("first words")).toBeNull();
  });
});
