import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import type { ReactElement } from "react";
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
import * as Link from "@/layout/Link";
import { chatPanelAtom } from "@/libs/chatPanel";
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
  // An unmodified click on a Link navigates in the app, as Next's Link does.
  vi.spyOn(Link, "default").mockImplementation(
    ({ href, children, onNavigate, prefetch: _prefetch, ...props }) => (
      <a
        {...props}
        href={String(href)}
        onClick={(event) => {
          event.preventDefault();
          onNavigate?.({ preventDefault() {} });
        }}
      >
        {children}
      </a>
    ),
  );
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
    await renderPanel(<ChallengePanel opponent={opponent} />);
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

  it("disables each option's button once its challenge is sent", async () => {
    spar.mockImplementation((_input, options) =>
      options.onSuccess({ success: true, message: "Challenge sent to Rival." }),
    );
    duel.mockResolvedValue({ ok: true, message: "Challenge sent to Rival." });
    await renderPanel(<ChallengePanel opponent={opponent} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Send Rival a sparring challenge" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Send Rival a Kessen challenge" }),
    );
    for (const name of ["Spar challenge sent", "Kessen duel challenge sent"]) {
      const sent = await screen.findByRole("button", { name });
      expect(sent.hasAttribute("disabled")).toBe(true);
      expect(sent.textContent).toBe("Sent");
      fireEvent.click(sent);
    }
    expect(spar).toHaveBeenCalledTimes(1);
    expect(duel).toHaveBeenCalledTimes(1);
  });

  it("sends a challenge from a conversation open to spectators, to announce it there", async () => {
    duel.mockResolvedValue({ ok: true, message: "Challenge sent to Rival." });
    await renderPanel(<ChallengePanel opponent={opponent} conversationId="tavern" />);
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

  it("duels with the player's ready deck and keeps it available after a refusal", async () => {
    duel.mockResolvedValue({
      ok: false,
      message: "That player has not learned Kessen yet.",
    });
    await renderPanel(<ChallengePanel opponent={opponent} />);
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
    const send = screen.getByRole("button", { name: "Send Rival a Kessen challenge" });
    expect(send.hasAttribute("disabled")).toBe(false);
  });

  it("keeps loaded decks usable when a background refetch fails", async () => {
    vi.spyOn(Hub, "useKessenHub").mockReturnValue({
      hub: {
        data: { needsLesson: false, decks: [{ id: DECK.id }], owned: {} },
        isError: true,
      },
      catalog: { data: { cards: [] }, isError: true },
    } as never);
    await renderPanel(<ChallengePanel opponent={opponent} />);
    expect(screen.queryByText(/Your decks could not be loaded/)).toBeNull();
    const send = screen.getByRole("button", { name: "Send Rival a Kessen challenge" });
    expect(send.hasAttribute("disabled")).toBe(false);
  });

  it("offers a retry when the decks never loaded", async () => {
    vi.spyOn(Hub, "useKessenHub").mockReturnValue({
      hub: { data: undefined, isError: true, refetch: vi.fn() },
      catalog: { data: { cards: [] }, isError: false, refetch: vi.fn() },
    } as never);
    await renderPanel(<ChallengePanel opponent={opponent} />);
    expect(screen.getByText(/Your decks could not be loaded/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send Rival a Kessen challenge" });
    expect(send.hasAttribute("disabled")).toBe(true);
  });

  it("points a player without the first Academy lesson to the Card Hall", async () => {
    needsLesson = true;
    await renderPanel(<ChallengePanel opponent={opponent} />);
    const send = screen.getByRole("button", { name: "Send Rival a Kessen challenge" });
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "Open the Card Hall" })).toBeTruthy();
    expect(duel).not.toHaveBeenCalled();
  });

  it("lets its holder close when one of its links opens a page", async () => {
    needsLesson = true;
    const onNavigate = vi.fn();
    await renderPanel(<ChallengePanel opponent={opponent} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Open the Card Hall" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
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

  it("closes the panel when its follow-up link opens a page", async () => {
    spar.mockImplementation((_input, options) =>
      options.onSuccess({ success: true, message: "Challenge sent to Rival." }),
    );
    render(<ChallengeButton opponent={opponent} />);
    fireEvent.click(screen.getByRole("button", { name: "Challenge Rival" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Send Rival a sparring challenge" }),
    );
    fireEvent.click(await screen.findByRole("link", { name: "Open the arena" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Challenge Rival" })).toBeNull(),
    );
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

  it("closes the chat panel when Watch opens the match", () => {
    getDefaultStore().set(chatPanelAtom, (current) => ({ ...current, owner: "panel" }));
    render(
      <ChallengeMatchNotice
        challenger="Hero"
        match={{ type: "SPAR", matchId: "m-1", opponentName: "Rival" }}
        createdAt={new Date()}
        compact
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "Watch" }));
    expect(getDefaultStore().get(chatPanelAtom).owner).toBeNull();
  });
});

/** Renders the panel and waits for its options, which load on demand. */
const renderPanel = async (panel: ReactElement) => {
  render(panel);
  await screen.findByRole("button", { name: "Send Rival a sparring challenge" });
};
