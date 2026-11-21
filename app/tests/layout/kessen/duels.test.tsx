import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import { DuelsView, type DuelsViewProps } from "@/layout/kessen/hub/DuelsPanel";
import type { KessenDeckSummary } from "@/layout/kessen/hub/hubData";
import type {
  KessenChallenge,
  KessenLeaderboard,
  KessenPvpLobby,
} from "@/validators/kessen";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const DECK: KessenDeckSummary = {
  id: "deck-1",
  name: "Frost Wall",
  faction: "HYORIN",
  leaderName: "Hisame",
  provision: 150,
  budget: 160,
  cards: 25,
  ready: true,
  fillable: true,
  problem: null,
};

const challenge = (patch: Partial<KessenChallenge>): KessenChallenge => ({
  id: "c1",
  outgoing: false,
  status: "PENDING",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 240_000),
  opponent: {
    userId: "u-rival",
    username: "Rival",
    level: 30,
    rank: "CHUNIN",
    villageName: "Akasumi",
  },
  matchId: null,
  ...patch,
});

const lobby = (patch: Partial<KessenPvpLobby> = {}): KessenPvpLobby => ({
  lessonCompleted: true,
  ranked: {
    rating: 1024,
    played: 3,
    wins: 2,
    losses: 1,
    draws: 0,
    rewardedToday: 1,
    rewardedCap: 5,
    weeklyWins: 2,
    weeklyPackWins: 5,
    winRyo: 800,
  },
  activeMatch: null,
  challenges: [],
  queue: null,
  queueCount: 0,
  ...patch,
});

const LADDER: KessenLeaderboard = {
  entries: [
    {
      rank: 1,
      userId: "u-top",
      username: "Topper",
      avatar: null,
      level: 50,
      rating: 1300,
      wins: 12,
      losses: 2,
      draws: 1,
    },
  ],
  you: {
    rank: 42,
    userId: "u-me",
    username: "Me",
    avatar: null,
    level: 30,
    rating: 1024,
    wins: 2,
    losses: 1,
    draws: 0,
  },
};

const ok = { ok: true, message: "Done." };

const renderView = (patch: Partial<DuelsViewProps> = {}) => {
  const actions = {
    createChallenge: vi.fn(async () => ok),
    acceptChallenge: vi.fn(async () => ok),
    rejectChallenge: vi.fn(async () => ok),
    cancelChallenge: vi.fn(async () => ok),
    joinRankedQueue: vi.fn(async () => ok),
    leaveRankedQueue: vi.fn(async () => ok),
    isChallenging: false,
    isAnswering: false,
    isJoining: false,
    isLeaving: false,
  };
  const onOpenDuel = vi.fn();
  render(
    <DuelsView
      lobby={lobby()}
      leaderboard={LADDER}
      leaderboardError={null}
      onRetryLeaderboard={() => {}}
      decks={[DECK]}
      defaultDeckId={DECK.id}
      loanerFaction="HYORIN"
      npcMatch={null}
      queueMessage={null}
      onOpenDuel={onOpenDuel}
      onResumeNpc={() => {}}
      actions={actions}
      renderFinder={() => <p>Finder</p>}
      {...patch}
    />,
  );
  return { actions, onOpenDuel };
};

beforeEach(() => {
  installBrowserGlobals({ scrollIntoView: true, resizeObserver: true });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("DuelsView", () => {
  it("answers incoming challenges and withdraws outgoing ones", async () => {
    const { actions } = renderView({
      lobby: lobby({
        challenges: [
          challenge({ id: "in" }),
          challenge({
            id: "out",
            outgoing: true,
            opponent: {
              userId: "u-friend",
              username: "Friend",
              level: 20,
              rank: "GENIN",
              villageName: null,
            },
          }),
        ],
      }),
    });
    expect(screen.getByText(/challenged you/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Accept the challenge from Rival" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Decline the challenge from Rival" }),
    );
    await waitFor(() => expect(actions.rejectChallenge).toHaveBeenCalledWith("in"));
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw your challenge to Friend" }),
    );
    await waitFor(() => expect(actions.cancelChallenge).toHaveBeenCalledWith("out"));
  });

  it("shows the search while queued and leaves the queue", async () => {
    const { actions } = renderView({
      lobby: lobby({ queue: { queuedAt: new Date(), matchId: null }, queueCount: 3 }),
    });
    expect(screen.getByText(/Searching for an opponent/)).toBeTruthy();
    expect(screen.getByText(/3 players are searching/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join the ranked queue/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Leave queue/ }));
    await waitFor(() => expect(actions.leaveRankedQueue).toHaveBeenCalled());
  });

  it("joins the queue with the chosen deck and opens a duel found at once", async () => {
    const { actions, onOpenDuel } = renderView();
    actions.joinRankedQueue.mockImplementation(async () => ({
      ...ok,
      matchId: "duel-1",
    }));
    fireEvent.click(screen.getByRole("button", { name: /Join the ranked queue/ }));
    await waitFor(() => expect(onOpenDuel).toHaveBeenCalledWith("duel-1"));
    expect(actions.joinRankedQueue).toHaveBeenCalledWith({
      source: "saved",
      deckId: DECK.id,
    });
  });

  it("lists the ladder and names the player's place below it", () => {
    renderView();
    expect(screen.getByRole("link", { name: "Topper" })).toBeTruthy();
    expect(screen.getByText(/Your place: #42 · 1024/)).toBeTruthy();
    expect(screen.getByText("1024")).toBeTruthy();
  });

  it("holds new duels back behind an unfinished match", () => {
    renderView({ npcMatch: { id: "m-npc", label: "Your match against Kimiko" } });
    expect(screen.getByText(/Your match against Kimiko is unfinished/)).toBeTruthy();
    const join = screen.getByRole("button", { name: /Join the ranked queue/ });
    expect((join as HTMLButtonElement).disabled).toBe(true);
  });
});
