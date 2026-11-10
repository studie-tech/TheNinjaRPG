import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as logbook from "@/layout/Logbook";
import * as Modal from "@/layout/Modal";
import * as UserContext from "@/utils/UserContext";

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
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
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

  it("sends the player to the NPC for a dialog bound to an overworld placement", () => {
    renderDialogStep("larry-placement");
    expect(screen.queryByRole("button", { name: "Tell me more" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("continues in person");
  });
});
