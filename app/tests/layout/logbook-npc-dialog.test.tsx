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
const renderDialogStep = (
  overworldPlacementId?: string,
  /** A finished training objective before the dialog, with its reward claimed or not. */
  trainingCollected?: boolean,
) => {
  const training = trainingCollected !== undefined;
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
        ...(training
          ? [
              {
                id: "train",
                task: "stats_trained",
                value: 1,
                reward_exp: 1000,
                nextObjectiveId: "greet",
              },
            ]
          : []),
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
      tracker={
        {
          id: "larry",
          goals: training
            ? [
                {
                  id: "train",
                  done: true,
                  collected: trainingCollected,
                  value: 1,
                  selectedNextObjectiveId: "greet",
                },
              ]
            : [],
        } as never
      }
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

  it("holds the next answer until the finished objective's reward is claimed", () => {
    renderDialogStep(undefined, false);
    expect(screen.queryByRole("button", { name: "Tell me more" })).toBeNull();
    expect(screen.getByRole("button", { name: "Claim 1,000 XP" })).toBeTruthy();
    cleanup();
    renderDialogStep(undefined, true);
    expect(screen.getByRole("button", { name: "Tell me more" })).toBeTruthy();
  });
});

/** Render an entry of `objectives` with these finished goals, as the dock shows it. */
const renderCompactEntry = (
  objectives: Record<string, unknown>[],
  goals: Record<string, unknown>[],
  reward: Record<string, unknown> = {},
) => {
  mockUserContextValue({
    data: { userId: "viewer", role: "USER", status: "AWAKE", dailyMissions: 0 },
    prepareUserUpdate: () => 1,
    updateUser: vi.fn(),
  } as never);
  const quest = {
    id: "road",
    name: "Road",
    questType: "starter",
    description: "",
    consecutiveObjectives: true,
    content: { objectives, reward },
  };
  return render(
    <logbook.LogbookEntry
      userQuest={
        {
          id: "road",
          questId: "road",
          quest,
          startedAt: new Date(0),
          completed: 0,
        } as never
      }
      tracker={{ id: "road", goals } as never}
      hideTitle
      compact
    />,
  );
};

describe("claims in the dock", () => {
  it("leads with an older unclaimed reward, ahead of the next answer", () => {
    renderCompactEntry(
      [
        {
          id: "level",
          task: "user_level",
          value: 5,
          reward_exp: 2500,
          nextObjectiveId: "exam",
        },
        { id: "exam", task: "stats_trained", value: 1, nextObjectiveId: "tour" },
        {
          id: "tour",
          task: "dialog",
          nextObjectiveId: [{ text: "Choose my village", nextObjectiveId: "choose" }],
        },
      ],
      [
        {
          id: "level",
          done: true,
          collected: false,
          value: 5,
          selectedNextObjectiveId: "exam",
        },
        {
          id: "exam",
          done: true,
          collected: true,
          value: 1,
          selectedNextObjectiveId: "tour",
        },
      ],
    );
    const claim = screen.getByRole("button", { name: "Claim 2,500 XP" });
    const answer = screen.getByRole("button", { name: "Choose my village" });
    expect(
      claim.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The answer wears the same style as the claims around it.
    expect(answer.className).not.toContain("bg-blue-600");
  });

  it("puts the answer before the objectives behind the player and the quest's reward", () => {
    renderCompactEntry(
      [
        {
          id: "level",
          task: "user_level",
          value: 5,
          reward_exp: 2500,
          nextObjectiveId: "arrive",
        },
        {
          id: "arrive",
          task: "move_to_location",
          sector: 222,
          nextObjectiveId: "tour",
        },
        {
          id: "tour",
          task: "dialog",
          nextObjectiveId: [{ text: "Choose my village", nextObjectiveId: "choose" }],
        },
      ],
      [
        {
          id: "level",
          done: true,
          collected: false,
          value: 5,
          selectedNextObjectiveId: "arrive",
        },
        {
          id: "arrive",
          done: true,
          collected: false,
          value: 0,
          sector: 222,
          selectedNextObjectiveId: "tour",
        },
      ],
      { reward_exp: 5000 },
    );
    const claim = screen.getByRole("button", { name: "Claim 2,500 XP" });
    const answer = screen.getByRole("button", { name: "Choose my village" });
    const arrived = screen.getByText(
      (_, element) =>
        element?.tagName === "P" && element.textContent === "Objective: Travel",
    );
    const rewards = screen.getByText("Rewards");
    const follows = (first: Node, second: Node) =>
      !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(claim, answer)).toBe(true);
    expect(follows(answer, arrived)).toBe(true);
    expect(follows(arrived, rewards)).toBe(true);
    // The finished trip takes one line: no location or map details in the dock.
    expect(screen.queryByText("Sector:")).toBeNull();
    expect(arrived.querySelector('[aria-label="Done"]')).toBeTruthy();
  });

  it("puts the finished quest's claim first, named like the objective claims", () => {
    renderCompactEntry(
      [{ id: "train", task: "stats_trained", value: 1 }],
      [{ id: "train", done: true, collected: true, value: 1 }],
      { reward_exp: 5000, reward_money: 20000, reward_rank: "GENIN" },
    );
    const claim = screen.getByRole("button", {
      name: "Claim Genin rank + 5,000 XP + 20,000 ryo",
    });
    const rewards = screen.getByText("Rewards");
    expect(
      claim.compareDocumentPosition(rewards) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Its long label wraps in the narrow dock instead of pushing the card sideways.
    expect(claim.className).toContain("whitespace-normal");
    expect(claim.className).not.toContain("whitespace-nowrap");
    expect(claim.className).toContain("h-auto");
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
    expect(toggle.getAttribute("aria-controls")).toBe(region.id);
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("max-h-96");
    expect(region.className).toContain("overflow-y-auto");
    expect(region.textContent).toMatch(/third words.*second words.*first words/);
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
