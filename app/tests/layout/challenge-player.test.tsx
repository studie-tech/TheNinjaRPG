import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as Hub from "@/hooks/kessen/useKessenHub";
import * as Lobby from "@/hooks/kessen/useKessenPvpLobby";
import {
  ChallengeButton,
  ChallengeMatchNotice,
  ChallengePanel,
} from "@/layout/ChallengePlayer";
import type { KessenDeckSummary } from "@/layout/kessen/hub/hubData";
import * as HubData from "@/layout/kessen/hub/hubData";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

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

const opponent = { userId: "u-rival", username: "Rival" };
const spar = vi.fn();
const duel = vi.fn();
let needsLesson = false;

beforeEach(() => {
  installBrowserGlobals();
  vi.clearAllMocks();
  needsLesson = false;
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ sparring: { getUserChallenges: { invalidate: vi.fn() } } }),
    sparring: {
      createChallenge: { useMutation: () => ({ mutate: spar, isPending: false }) },
    },
  });
  vi.spyOn(Hub, "useKessenHub").mockImplementation(
    () =>
      ({
        hub: {
          data: {
            needsLesson,
            decks: [{ id: DECK.id }],
            owned: {},
            loanerFaction: "AKASUMI",
          },
          isError: false,
        },
        catalog: { data: { cards: [] }, isError: false },
      }) as never,
  );
  vi.spyOn(HubData, "summarizeDeck").mockReturnValue(DECK);
  vi.spyOn(Lobby, "useKessenPvpLobby").mockReturnValue({
    createChallenge: duel,
    isChallenging: false,
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("challenge panel", () => {
  it("sends a spar with the chosen rules and answers next to it", async () => {
    spar.mockImplementation((_input, options) =>
      options.onSuccess({ success: true, message: "Challenge sent to Rival." }),
    );
    render(<ChallengePanel opponent={opponent} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Allow spectators/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Send Rival a sparring challenge" }),
    );
    expect(spar.mock.calls[0]?.[0]).toEqual({
      targetId: "u-rival",
      useRankedRules: false,
      spectatable: true,
    });
    const sent = await screen.findByRole("status");
    expect(sent.textContent).toContain("Challenge sent to Rival.");
    expect(screen.getByRole("link", { name: "Open the arena" })).toBeTruthy();
  });

  it("sends a challenge from a conversation open to spectators, to announce it there", () => {
    duel.mockResolvedValue({ ok: true, message: "Challenge sent to Rival." });
    render(<ChallengePanel opponent={opponent} conversationId="tavern" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Send Rival a sparring challenge" }),
    );
    expect(spar.mock.calls[0]?.[0]).toEqual({
      targetId: "u-rival",
      useRankedRules: false,
      spectatable: true,
      conversationId: "tavern",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send Rival a Kessen challenge" }),
    );
    expect(duel.mock.calls[0]?.[0]).toMatchObject({ conversationId: "tavern" });
  });

  it("duels with the player's ready deck and shows a refusal by the button", async () => {
    duel.mockResolvedValue({
      ok: false,
      message: "That player has not learned Kessen yet.",
    });
    render(<ChallengePanel opponent={opponent} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Send Rival a Kessen challenge" }),
    );
    expect(duel).toHaveBeenCalledWith({
      targetId: "u-rival",
      deck: { source: "saved", deckId: "deck-1" },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "That player has not learned Kessen yet.",
      ),
    );
  });

  it("keeps loaded decks usable when a background refetch fails", () => {
    vi.spyOn(Hub, "useKessenHub").mockReturnValue({
      hub: {
        data: { needsLesson: false, decks: [{ id: DECK.id }], owned: {} },
        isError: true,
      },
      catalog: { data: { cards: [] }, isError: true },
    } as never);
    render(<ChallengePanel opponent={opponent} />);
    expect(screen.queryByText(/Your decks could not be loaded/)).toBeNull();
    const send = screen.getByRole("button", { name: "Send Rival a Kessen challenge" });
    expect(send.hasAttribute("disabled")).toBe(false);
  });

  it("offers a retry when the decks never loaded", () => {
    vi.spyOn(Hub, "useKessenHub").mockReturnValue({
      hub: { data: undefined, isError: true, refetch: vi.fn() },
      catalog: { data: { cards: [] }, isError: false, refetch: vi.fn() },
    } as never);
    render(<ChallengePanel opponent={opponent} />);
    expect(screen.getByText(/Your decks could not be loaded/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send Rival a Kessen challenge" });
    expect(send.hasAttribute("disabled")).toBe(true);
  });

  it("points a player without the first Academy lesson to the Card Hall", () => {
    needsLesson = true;
    render(<ChallengePanel opponent={opponent} />);
    const send = screen.getByRole("button", { name: "Send Rival a Kessen challenge" });
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "Open the Card Hall" })).toBeTruthy();
    expect(duel).not.toHaveBeenCalled();
  });
});

describe("challenge button", () => {
  it("focuses the opened panel, not its first Send button", async () => {
    render(<ChallengeButton opponent={opponent} />);
    fireEvent.click(screen.getByRole("button", { name: "Challenge Rival" }));
    const send = await screen.findByRole("button", {
      name: "Send Rival a sparring challenge",
    });
    const panel = screen.getByRole("dialog", { name: "Challenge Rival" });
    await waitFor(() => expect(document.activeElement).toBe(panel));
    expect(panel.contains(send)).toBe(true);
  });
});

describe("challenge match notice", () => {
  it.each([
    ["SPAR", "started a spar", "/battlelog/m-1"],
    ["KESSEN", "started a Kessen duel", "/kessen/watch/m-1"],
  ] as const)(
    "announces a %s on one line with a link to watch it",
    (type, text, href) => {
      render(
        <ChallengeMatchNotice
          challenger="Hero"
          match={{ type, matchId: "m-1", opponentName: "Rival" }}
          createdAt={new Date()}
        />,
      );
      expect(document.body.textContent).toContain(`Hero and Rival ${text}`);
      expect(screen.getByRole("link", { name: "Watch" }).getAttribute("href")).toBe(
        href,
      );
    },
  );
});
