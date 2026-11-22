import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { KessenQuestChallenge } from "@/layout/KessenQuestChallenge";
import type { KessenDeckSummary } from "@/layout/kessen/hub/hubData";
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

const CHALLENGE = {
  quest: { id: "q1", name: "Cards at Dusk" },
  objective: {
    id: "duel",
    task: "win_kessen_challenge",
    npcKey: "kazehiko",
    tier: "standard",
    description: "",
    sector: 724,
    longitude: 10,
    latitude: 7,
    hideLocation: false,
  },
  done: false,
  available: true,
  atLocation: true,
} as unknown as ComponentProps<typeof KessenQuestChallenge>["challenge"];

const renderBriefing = (
  patch: Partial<ComponentProps<typeof KessenQuestChallenge>> = {},
) => {
  const onStart = vi.fn();
  render(
    <KessenQuestChallenge
      challenge={CHALLENGE}
      opponent={undefined}
      decks={[DECK]}
      defaultDeckId={DECK.id}
      loanerFaction="HYORIN"
      isStarting={false}
      error={null}
      onStart={onStart}
      {...patch}
    />,
  );
  return { onStart };
};

beforeEach(() => {
  installBrowserGlobals({ scrollIntoView: true, resizeObserver: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("KessenQuestChallenge", () => {
  it("offers the deck picker and a seat when nothing is unfinished", () => {
    const { onStart } = renderBriefing();
    fireEvent.click(screen.getByRole("button", { name: /Take a seat/ }));
    expect(onStart).toHaveBeenCalledWith({ source: "saved", deckId: DECK.id });
  });

  it("leads back to an unfinished duel and says why the seat is closed", () => {
    const onOpen = vi.fn();
    const { onStart } = renderBriefing({
      resume: {
        label: "Resume your duel vs Rival",
        unfinished: "Your duel against Rival",
        isThisDuel: false,
        isPlayerDuel: true,
        onOpen,
      },
    });
    expect(
      screen.getByText(
        "Your duel against Rival is unfinished. Finish or concede it before you take a seat.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Take a seat/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Concede/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Resume your duel vs Rival/ }));
    expect(onOpen).toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("offers to concede another NPC match and take the seat in its place", () => {
    const onOpen = vi.fn();
    const { onStart } = renderBriefing({
      resume: {
        label: "Resume vs Lemu",
        unfinished: "Your match against Lemu",
        isThisDuel: false,
        isPlayerDuel: false,
        onOpen,
      },
    });
    expect(
      screen.getByText(
        "Your match against Lemu is unfinished. Resume it, or concede it to take a seat.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Take a seat/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Resume vs Lemu/ }));
    expect(onOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Concede it and take a seat/ }));
    expect(screen.getByText("Concede your match against Lemu?")).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Concede and challenge/ }));
    expect(onStart).toHaveBeenCalledWith({ source: "saved", deckId: DECK.id }, true);
  });

  it("leads back to its own duel left for the hall without asking to concede it", () => {
    const onOpen = vi.fn();
    renderBriefing({
      resume: {
        label: "Resume vs Kazehiko",
        unfinished: "Your match against Kazehiko",
        isThisDuel: true,
        isPlayerDuel: false,
        onOpen,
      },
    });
    expect(screen.getByText("This duel is under way.")).toBeTruthy();
    expect(screen.queryByText(/Finish or concede/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Take a seat/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Concede/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Return to the table/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});
