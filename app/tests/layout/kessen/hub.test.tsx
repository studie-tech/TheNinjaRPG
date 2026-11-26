import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  IMG_KESSEN_NPC_PORTRAITS,
  KESSEN_COPY_LIMITS,
  KESSEN_MAX_DECKS,
} from "@/drizzle/constants";
import * as mediaQuery from "@/hooks/useMediaQuery";
import { CircuitMap } from "@/layout/kessen/hub/CircuitMap";
import { CollectionBook } from "@/layout/kessen/hub/CollectionBook";
import { DeckBuilder, type KessenDeckSaveInput } from "@/layout/kessen/hub/DeckBuilder";
import { HallHeader } from "@/layout/kessen/hub/HallHeader";
import {
  activeMatchStateText,
  ascendedFirstWinRewardLines,
  catalogLookup,
  circuitPinPosition,
  firstWinRewardLines,
  kessenWinText,
  lockProgressText,
  mapPinOrder,
  npcPortrait,
  summarizeDeck,
  whereToFind,
} from "@/layout/kessen/hub/hubData";
import { NpcDetail } from "@/layout/kessen/hub/NpcSheet";
import { PackOpening } from "@/layout/kessen/hub/PackOpening";
import { formatOdds, PacksPanel } from "@/layout/kessen/hub/PacksPanel";
import { StarterChoice } from "@/layout/kessen/hub/StarterChoice";
import { starterDeck } from "@/libs/kessen/deck";
import { KESSEN_NPCS } from "@/libs/kessen/npcs";
import { KESSEN_KEYWORDS } from "@/libs/kessen/text";
import { KessenFactions } from "@/validators/itemCard";
import type {
  KessenCatalogEntry,
  KessenCircuitEntry,
  KessenDeckRow,
  KessenHub,
  KessenPackEntry,
} from "@/validators/kessen";
import type { CardPackReveal } from "@/validators/weightedCache";
import {
  KESSEN_FORBIDDEN,
  KESSEN_SEED_CATALOG,
  seedCardByName,
} from "../../libs/kessen/fixtures/catalog";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const ART = "https://uploadthing.b-cdn.net/f/kessen-art.webp";

const CARDS: KessenCatalogEntry[] = KESSEN_SEED_CATALOG.map((card, index) => ({
  ...card,
  image: ART,
  artUrl: ART,
  focalX: 50,
  focalY: 30,
  flavor: "",
  abilityName: null,
  number: card.kind === "LEADER" ? null : index + 1,
}));

const ODDS = {
  normal: { COMMON: 7600, RARE: 1940, EPIC: 400, LEGENDARY: 59, FORBIDDEN: 1 },
  rareSlot: { COMMON: 0, RARE: 8300, EPIC: 1500, LEGENDARY: 196, FORBIDDEN: 4 },
};
const ALL_FACTIONS: KessenPackEntry["factions"] = [...KessenFactions];
const PACKS: KessenPackEntry[] = [
  {
    id: "kessen-pack-paper",
    name: "Paper Bundle",
    image: "",
    description: "",
    odds: ODDS,
    slots: { normal: 4, rareSlot: 1 },
    factions: ALL_FACTIONS,
  },
  {
    id: "kessen-pack-village-hyorin",
    name: "Hyorin Village Bundle",
    image: "",
    description: "",
    odds: ODDS,
    slots: { normal: 4, rareSlot: 1 },
    factions: ["HYORIN", "NEUTRAL"],
  },
];

const circuitEntry = (
  key: string,
  overrides: Partial<KessenCircuitEntry> = {},
): KessenCircuitEntry => {
  const npc = KESSEN_NPCS.find((entry) => entry.key === key);
  if (!npc) throw new Error(`missing NPC ${key}`);
  return {
    key: npc.key,
    name: npc.name,
    title: npc.title,
    location: npc.location,
    image: npc.image,
    faction: npc.faction,
    boss: npc.boss,
    champion: npc.champion,
    tier: npc.standard.tier,
    ascendedTier: npc.ascended?.tier ?? null,
    lockReason: null,
    ascendedLockReason: npc.ascended ? "Beat all six village champions." : null,
    wins: 0,
    firstWinAt: null,
    ascendedFirstWinAt: null,
    firstWinPreview: npc.standard.firstWin.items.map((item) => item.itemId),
    houseRule: npc.standard.houseRule ?? npc.ascended?.houseRule ?? null,
    teaches: [...npc.teaches],
    recommendedLesson: null,
    ...overrides,
  };
};

const STARTER = starterDeck("SHIROHANA");
const OWNED: Record<string, number> = {
  [STARTER.leaderId]: 1,
  ...Object.fromEntries(STARTER.cards.map((entry) => [entry.itemId, entry.count])),
};
const DECK: KessenDeckRow = {
  id: "deck-1",
  name: "Sunward Starter",
  leaderItemId: STARTER.leaderId,
  cards: STARTER.cards,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
};

beforeEach(() => {
  installBrowserGlobals({ scrollIntoView: true });
  vi.spyOn(mediaQuery, "useMediaQuery").mockImplementation(() => false);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("Card Hall data helpers", () => {
  it("moves Momo's pin to the village she visits today", () => {
    const hyorin = circuitPinPosition({ key: "momo", location: "Hyorin teahouse" });
    const akasumi = circuitPinPosition({ key: "momo", location: "Akasumi teahouse" });
    expect(hyorin).not.toEqual(akasumi);
    expect(circuitPinPosition({ key: "lemu", location: "anywhere" })).toEqual(
      circuitPinPosition({ key: "lemu", location: "Horizon academy" }),
    );
  });

  it("keeps pins inside the map frame and focuses them by difficulty, then across the map", () => {
    for (const npc of KESSEN_NPCS) {
      const position = circuitPinPosition({ key: npc.key, location: npc.location });
      expect(position.x).toBeGreaterThanOrEqual(9);
      expect(position.x).toBeLessThanOrEqual(91);
      expect(position.y).toBeGreaterThanOrEqual(13);
      expect(position.y).toBeLessThanOrEqual(79);
    }
    const pin = (key: string) => {
      const entry = circuitEntry(key);
      return { entry, position: circuitPinPosition(entry) };
    };
    const order = mapPinOrder([
      pin("unmeishi"),
      pin("hisame"),
      pin("lemu"),
      pin("kimiko"),
      pin("kazehiko"),
    ]).map(({ entry }) => entry.key);
    expect(order.slice(0, 2)).toEqual(["kazehiko", "lemu"]);
    // Champions read top row first; the boss comes last.
    expect(order.indexOf("kimiko")).toBeLessThan(order.indexOf("hisame"));
    expect(order.at(-1)).toBe("unmeishi");
  });

  it("names reward choices and titles among the first-win rewards", () => {
    const lookup = catalogLookup(CARDS);
    expect(firstWinRewardLines(circuitEntry("unmeishi"), lookup, PACKS)).toEqual([
      "any legendary you don't own",
      "the title Thread-Reader",
    ]);
    expect(
      firstWinRewardLines(
        circuitEntry("unmeishi", { firstWinAt: new Date("2026-11-01T00:00:00Z") }),
        lookup,
        PACKS,
      ),
    ).toEqual([]);
  });

  it("names the Ascended first-win choice only while that rematch is open and unbeaten", () => {
    const lookup = catalogLookup(CARDS);
    const open = { ascendedLockReason: null, firstWinAt: new Date("2026-11-01") };
    expect(
      ascendedFirstWinRewardLines(circuitEntry("hisame", open), lookup, PACKS),
    ).toEqual(["one of Subaku Winged Captain or Amaterasu's Holy Mirror"]);
    expect(ascendedFirstWinRewardLines(circuitEntry("hisame"), lookup, PACKS)).toEqual(
      [],
    );
    expect(
      ascendedFirstWinRewardLines(
        circuitEntry("hisame", { ...open, ascendedFirstWinAt: new Date("2026-11-02") }),
        lookup,
        PACKS,
      ),
    ).toEqual([]);
    expect(ascendedFirstWinRewardLines(circuitEntry("lemu"), lookup, PACKS)).toEqual(
      [],
    );
  });

  it("adds unlock progress and chained locks to lock reasons", () => {
    const beaten = new Date("2026-11-01T00:00:00Z");
    const circuit = [
      circuitEntry("kimiko", { firstWinAt: beaten }),
      circuitEntry("junko", { firstWinAt: beaten }),
      circuitEntry("hisame"),
      circuitEntry("anbu-chief", { lockReason: "Beat any 3 village champions." }),
      circuitEntry("momo", { lockReason: "Beat all six village champions." }),
      circuitEntry("shishi", { lockReason: "Beat Anbu Chief and Momo." }),
      circuitEntry("unmeishi", { lockReason: "Beat Shishi." }),
    ];
    const text = (key: string) => {
      const entry = circuit.find((candidate) => candidate.key === key);
      return entry ? lockProgressText(entry.lockReason, entry, circuit) : null;
    };
    expect(text("anbu-chief")).toBe("Beat any 3 village champions · 2/3");
    expect(text("unmeishi")).toBe(
      "Beat Shishi. Shishi unlocks once you beat Anbu Chief and Momo · 0/2.",
    );
    // A lock naming several opponents counts the ones beaten.
    expect(text("shishi")).toMatch(
      /^Beat Anbu Chief and Momo · 0\/2\. Anbu Chief unlocks/,
    );
    const unmeishi = circuit.find((entry) => entry.key === "unmeishi");
    if (!unmeishi) throw new Error("missing Unmeishi");
    // Rows keep one sentence; the chain is for the sheet.
    expect(
      lockProgressText(unmeishi.lockReason, unmeishi, circuit, "standard", false),
    ).toBe("Beat Shishi.");
    const hisame = circuit.find((entry) => entry.key === "hisame");
    if (!hisame) throw new Error("missing Hisame");
    expect(
      lockProgressText(hisame.ascendedLockReason, hisame, circuit, "ascended"),
    ).toBe("Beat all six village champions · 2/6");
  });

  it("counts wins by mode and states a live match's round and score", () => {
    expect(kessenWinText({ wins: 1, ascendedFirstWinAt: null })).toEqual({
      standard: "1 win",
      ascended: null,
      total: null,
    });
    expect(
      kessenWinText({ wins: 2, ascendedFirstWinAt: new Date("2026-11-02T00:00:00Z") }),
    ).toEqual({ standard: null, ascended: "beaten", total: "2 wins in all" });
    expect(activeMatchStateText({ round: 3, roundWins: [1, 1], yourTurn: true })).toBe(
      "Round 3 · 1–1 · your turn",
    );
  });

  it("names the home champion a champion lock waits on", () => {
    const circuit = [
      circuitEntry("kimiko"),
      circuitEntry("hisame", { lockReason: "Beat your home champion." }),
    ];
    const [kimiko, hisame] = circuit;
    if (!kimiko || !hisame) throw new Error("missing entries");
    expect(lockProgressText(hisame.lockReason, hisame, circuit)).toBe(
      `Beat ${kimiko.name}, your home champion.`,
    );
  });

  it("shows painted portraits only once an opponent is open", () => {
    const momo = circuitEntry("momo");
    expect(npcPortrait(momo)).toBe(IMG_KESSEN_NPC_PORTRAITS.momo);
    expect(
      npcPortrait({ ...momo, lockReason: "Beat all six village champions." }),
    ).toBe(momo.image);
  });

  it("summarizes a saved deck as ready, fillable or broken", () => {
    const lookup = catalogLookup(CARDS);
    expect(summarizeDeck(DECK, lookup, OWNED)).toMatchObject({
      ready: true,
      faction: "SHIROHANA",
      cards: 25,
      problem: null,
    });
    const short = summarizeDeck(
      { ...DECK, cards: DECK.cards.slice(0, 4) },
      lookup,
      OWNED,
    );
    expect(short.ready).toBe(false);
    expect(short.fillable).toBe(true);
    const leaderless = summarizeDeck(
      { ...DECK, leaderItemId: "kessen-missing" },
      lookup,
      OWNED,
    );
    expect(leaderless.fillable).toBe(false);
    expect(leaderless.problem).toBe("Choose a leader.");
  });

  it("derives where a card can be found from packs and the Circuit", () => {
    const lookup = catalogLookup(CARDS);
    const cryverin = lookup[seedCardByName("Cryverin").id];
    if (!cryverin) throw new Error("missing Cryverin");
    const sources = whereToFind(cryverin, { packs: PACKS, circuit: [] });
    expect(sources).toContain("Paper Bundle");
    expect(sources).toContain("Hyorin Village Bundle");
    expect(sources).toContain("Wins against Kimiko");

    // A Neutral card sits in every Village Bundle: one line names them all.
    const neutral = CARDS.find(
      (card) =>
        card.faction === "NEUTRAL" && card.kind === "UNIT" && card.rarity === "COMMON",
    );
    if (!neutral) throw new Error("missing a Neutral common");
    const villages: KessenPackEntry[] = [
      ...PACKS,
      {
        ...PACKS[1]!,
        id: "kessen-pack-village-akasumi",
        name: "Akasumi Village Bundle",
      },
    ];
    const neutralSources = whereToFind(neutral, { packs: villages, circuit: [] });
    expect(neutralSources).toContain("Any Village Bundle");
    expect(neutralSources).not.toContain("Hyorin Village Bundle");

    const moonprowler = lookup[seedCardByName("Moonprowler").id];
    if (!moonprowler) throw new Error("missing Moonprowler");
    expect(whereToFind(moonprowler, { packs: PACKS, circuit: [] })).not.toContain(
      "Hyorin Village Bundle",
    );

    // A staff-created pack names a card by the factions its caches actually hold.
    const frostCrate: KessenPackEntry = {
      ...PACKS[0]!,
      id: "kessen-pack-staff-made",
      name: "Frost Crate",
      factions: ["HYORIN", "NEUTRAL"],
    };
    const crate = { packs: [frostCrate], circuit: [] };
    expect(whereToFind(cryverin, crate)).toContain("Frost Crate");
    expect(whereToFind(moonprowler, crate)).not.toContain("Frost Crate");

    const altLeader = lookup["kessen-leader-frost-sovereign"];
    if (!altLeader) throw new Error("missing Frost Sovereign");
    const extra = { [altLeader.id]: ["Teahouse questline"] };
    expect(whereToFind(altLeader, { packs: PACKS, circuit: [], extra })).toEqual([
      "First win against Kimiko",
      "Teahouse questline",
    ]);
  });

  it("leaves out one-time sources the player has already used", () => {
    const lookup = catalogLookup(CARDS);
    const altLeader = lookup["kessen-leader-frost-sovereign"];
    const cryverin = lookup[seedCardByName("Cryverin").id];
    if (!altLeader || !cryverin) throw new Error("missing cards");
    const beaten = [circuitEntry("kimiko", { firstWinAt: new Date("2026-11-01") })];
    expect(whereToFind(altLeader, { packs: PACKS, circuit: beaten })).toEqual([]);
    const first: KessenPackEntry = {
      id: "kessen-pack-first",
      name: "First Bundle",
      image: "",
      description: "",
      odds: ODDS,
      slots: { normal: 4, rareSlot: 1 },
      factions: ALL_FACTIONS,
    };
    const packs = [...PACKS, first];
    expect(whereToFind(cryverin, { packs, circuit: [] })).not.toContain("First Bundle");
    expect(
      whereToFind(cryverin, { packs, circuit: [], firstBundleAhead: true }),
    ).toContain("First Bundle");
  });
});

describe("StarterChoice", () => {
  it("preselects the village faction and confirms the choice", () => {
    const onChoose = vi.fn();
    render(<StarterChoice homeFaction="HYORIN" cards={CARDS} onChoose={onChoose} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Take the Hyorin starter deck" }),
    );
    expect(onChoose).toHaveBeenCalledWith("HYORIN");
    fireEvent.click(screen.getByRole("radio", { name: /Akikaze/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Take the Akikaze starter deck" }),
    );
    expect(onChoose).toHaveBeenLastCalledWith("AKIKAZE");
  });

  it("lists the chosen faction's starter deck card by card", () => {
    render(<StarterChoice homeFaction="HYORIN" cards={CARDS} onChoose={vi.fn()} />);
    const list = () => screen.getByRole("region", { name: "Hyorin starter deck" });
    const hyorin = starterDeck("HYORIN");
    const rows = within(list()).getAllByRole("listitem");
    expect(rows).toHaveLength(hyorin.cards.length);
    const first = hyorin.cards[0]!;
    const firstCard = CARDS.find((card) => card.id === first.itemId)!;
    expect(within(list()).getByText(firstCard.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Akikaze/ }));
    const akikaze = screen.getByRole("region", { name: "Akikaze starter deck" });
    expect(within(akikaze).getAllByRole("listitem")).toHaveLength(
      starterDeck("AKIKAZE").cards.length,
    );
  });

  it("leads the grid with the village faction", () => {
    render(<StarterChoice homeFaction="TSUKIMORI" cards={CARDS} onChoose={vi.fn()} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)[0]).toBe("TSUKIMORI");
    expect(radios).toHaveLength(6);
    expect(radios[0]?.checked).toBe(true);
  });
});

const LIVE_MATCH: Omit<NonNullable<KessenHub["activeMatch"]>, "npcKey"> = {
  id: "match-9",
  mode: "standard",
  lesson: null,
  challenge: null,
  round: 1,
  roundWins: [0, 0],
  yourTurn: true,
};

describe("NpcDetail", () => {
  const base = {
    cards: CARDS,
    packs: PACKS,
    decks: [summarizeDeck(DECK, catalogLookup(CARDS), OWNED)],
    loanerFaction: "SHIROHANA" as const,
    needsLesson: false,
    seenKeywords: [],
    activeMatch: null,
    onResume: () => undefined,
    onStartLesson: () => undefined,
  };

  it("recommends the unfinished lesson that teaches the opponent's keywords", () => {
    const onStartLesson = vi.fn();
    render(
      <NpcDetail
        {...base}
        entry={circuitEntry("kimiko", { recommendedLesson: "spread-out" })}
        onStart={() => undefined}
        onStartLesson={onStartLesson}
      />,
    );
    expect(screen.getByText("Learn Spread Out first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take the lesson" }));
    expect(onStartLesson).toHaveBeenCalledWith("spread-out", false);
  });

  it("starts with the ready saved deck, or a borrowed deck of a chosen faction", async () => {
    const onStart = vi.fn();
    render(<NpcDetail {...base} entry={circuitEntry("junko")} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: "Challenge Junko" }));
    expect(onStart).toHaveBeenLastCalledWith({
      npcKey: "junko",
      mode: "standard",
      deck: { source: "saved", deckId: "deck-1" },
    });
    // Radix Select scrolls its selected option into view, which the test DOM lacks.
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => undefined;
    fireEvent.click(
      screen.getByRole("combobox", { name: "Faction of the borrowed deck" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Hyorin" }));
    Element.prototype.scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByRole("button", { name: "Challenge Junko" }));
    expect(onStart).toHaveBeenLastCalledWith({
      npcKey: "junko",
      mode: "standard",
      deck: { source: "loaner", faction: "HYORIN" },
    });
  });

  it("offers a won first-win card still to choose instead of calling it claimed", () => {
    const onResume = vi.fn();
    const hisame = circuitEntry("hisame", {
      firstWinAt: new Date("2026-11-10T00:00:00Z"),
      ascendedFirstWinAt: new Date("2026-11-12T00:00:00Z"),
      ascendedLockReason: null,
      wins: 2,
    });
    const { rerender } = render(
      <NpcDetail
        {...base}
        entry={hisame}
        pendingPicks={[{ matchId: "match-pick", npcKey: "hisame" }]}
        onResume={onResume}
        onStart={() => undefined}
      />,
    );
    expect(screen.queryByText(/First win claimed/)).toBeNull();
    expect(screen.getByText(/first-win reward from Hisame is waiting/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose your reward" }));
    expect(onResume).toHaveBeenCalledWith("match-pick");
    rerender(
      <NpcDetail
        {...base}
        entry={hisame}
        pendingPicks={[]}
        onResume={onResume}
        onStart={() => undefined}
      />,
    );
    expect(screen.getByText(/First win claimed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose your reward" })).toBeNull();
  });

  it("shows the house rule of the selected mode and marks a locked Ascended tier", () => {
    render(
      <NpcDetail {...base} entry={circuitEntry("hisame")} onStart={() => undefined} />,
    );
    // Both modes' rules share the slot under the switch; only the chosen one is shown.
    const ascendedRule = screen.getByText(/Ascended house rule/);
    expect(
      ascendedRule.closest(".kh-rule-slot-mode")?.getAttribute("aria-hidden"),
    ).toBe("true");
    const teaser = screen.getByText(/The Ascended rematch (adds|uses)/);
    expect(teaser.closest(".kh-rule-slot-mode")?.hasAttribute("data-active")).toBe(
      true,
    );
    expect(screen.getByText("(locked)", { exact: false })).toBeTruthy();
    expect(
      (screen.getByRole("tab", { name: /Ascended · / }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows the open Ascended first win beside a claimed standard one", () => {
    const hisame = circuitEntry("hisame", {
      firstWinAt: new Date("2026-11-10T00:00:00Z"),
      ascendedLockReason: null,
      wins: 1,
    });
    const { rerender } = render(
      <NpcDetail {...base} entry={hisame} onStart={() => undefined} />,
    );
    expect(screen.getByText(/^Standard first win claimed/)).toBeTruthy();
    const reward = screen.getByRole("region", { name: "Ascended first win reward" });
    expect(reward.textContent).toContain("choose one");
    expect(reward.querySelectorAll(".kh-reward-item")).toHaveLength(2);
    rerender(
      <NpcDetail
        {...base}
        entry={{ ...hisame, ascendedFirstWinAt: new Date("2026-11-12T00:00:00Z") }}
        onStart={() => undefined}
      />,
    );
    expect(screen.getByText(/^First win claimed in both modes/)).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Ascended first win reward" }),
    ).toBeNull();
  });

  it("previews a reward choice and title for the final boss", () => {
    render(
      <NpcDetail
        {...base}
        entry={circuitEntry("unmeishi")}
        onStart={() => undefined}
      />,
    );
    const reward = screen.getByRole("region", { name: "First win reward" });
    expect(reward.textContent).toContain("Choose any legendary you don't own");
    expect(reward.textContent).toContain("Thread-Reader");
  });

  it("shows the unlock condition instead of start controls when locked", () => {
    render(
      <NpcDetail
        {...base}
        entry={circuitEntry("shishi", { lockReason: "Beat Anbu Chief and Momo." })}
        onStart={() => undefined}
      />,
    );
    expect(screen.getByText("Beat Anbu Chief and Momo.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Challenge/ })).toBeNull();
  });

  it("leads with resuming an unfinished match and confirms conceding it", async () => {
    const onStart = vi.fn();
    const onResume = vi.fn();
    render(
      <NpcDetail
        {...base}
        activeMatch={{ ...LIVE_MATCH, npcKey: "kimiko" }}
        entry={circuitEntry("junko")}
        onStart={onStart}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Resume vs Kimiko/ }));
    expect(onResume).toHaveBeenCalledWith("match-9");
    expect(screen.queryByRole("button", { name: /Concede and challenge/ })).toBeNull();
    const concede = screen.getByRole("button", {
      name: /^Concede it to challenge Junko/,
    });
    fireEvent.click(concede);
    expect(onStart).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("ends as a loss");
    // Closing the confirmation starts nothing and returns to the button that opened it.
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onStart).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(concede));
    fireEvent.click(concede);
    fireEvent.click(
      await screen.findByRole("button", { name: "Concede and challenge Junko" }),
    );
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ npcKey: "junko", replaceActive: true }),
    );
  });

  it("states the live match's round and score, and wins by mode", () => {
    render(
      <NpcDetail
        {...base}
        activeMatch={{ ...LIVE_MATCH, npcKey: "hisame", round: 3, roundWins: [1, 1] }}
        entry={circuitEntry("hisame", {
          wins: 1,
          firstWinAt: new Date("2026-11-01T00:00:00Z"),
        })}
        onStart={() => undefined}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Round 3 · 1–1 · your turn",
    );
    // The count sits in the standard tier's chip, not after the Ascended one.
    expect(screen.getByText(/· 1 win$/).getAttribute("data-tier")).toBe("standard");
  });

  it("offers the first lesson, replacing an unfinished match", () => {
    const onStart = vi.fn();
    const onStartLesson = vi.fn();
    render(
      <NpcDetail
        {...base}
        needsLesson
        activeMatch={{ ...LIVE_MATCH, npcKey: "kimiko" }}
        entry={circuitEntry("lemu", { lockReason: "Finish Lemu's lesson first." })}
        onStart={onStart}
        onStartLesson={onStartLesson}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Learn in 2 minutes with Lemu" }),
    );
    expect(onStartLesson).toHaveBeenCalledWith("first-blood", true);
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("DeckBuilder", () => {
  it("validates inline and saves the edited deck", async () => {
    const onSave = vi.fn((_input: KessenDeckSaveInput) =>
      Promise.resolve({ ok: true, deckId: "deck-1" }),
    );
    render(
      <DeckBuilder
        cards={CARDS}
        owned={OWNED}
        decks={[DECK]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={onSave}
        onDelete={() => Promise.resolve(true)}
      />,
    );
    expect(screen.getByText("Ready to play.")).toBeTruthy();
    const kawarimi = seedCardByName("Kawarimi");
    fireEvent.click(
      screen.getAllByRole("button", { name: `Remove one ${kawarimi.name}` })[0]!,
    );
    expect(screen.getByText(/Add 1 more card/)).toBeTruthy();
    // A short deck still saves; the removed copy is still owned, so matches complete the
    // deck with it instead of lending one.
    expect(screen.queryByText(/matches lend/)).toBeNull();
    const save = screen.getByRole("button", { name: "Save deck" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const shortCards =
      (onSave.mock.calls[0]?.[0] as KessenDeckSaveInput | undefined)?.cards ?? [];
    expect(shortCards.reduce((sum, entry) => sum + entry.count, 0)).toBe(
      STARTER.cards.reduce((sum, entry) => sum + entry.count, 0) - 1,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Add one Kawarimi" })[0]!);
    expect(screen.queryByText(/as borrowed copies/)).toBeNull();
    // Back to the saved list: nothing to save until something changes.
    expect(
      (screen.getByRole("button", { name: "Save deck" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("No unsaved changes.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Deck name" }), {
      target: { value: "Dune Riders" },
    });
    expect(screen.getByText("Unsaved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]).toEqual([
      expect.objectContaining({
        id: "deck-1",
        name: "Dune Riders",
        leaderItemId: STARTER.leaderId,
      }),
    ]);
  });

  it("confirms before another deck replaces unsaved edits", async () => {
    const other: KessenDeckRow = { ...DECK, id: "deck-2", name: "Second" };
    render(
      <DeckBuilder
        cards={CARDS}
        owned={OWNED}
        decks={[DECK, other]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={() => Promise.resolve({ ok: true })}
        onDelete={() => Promise.resolve(true)}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove one / })[0]!);
    const second = screen.getByRole("button", { name: /Second/ });
    second.focus();
    fireEvent.click(second);
    expect(screen.getByRole("dialog").textContent).toContain("unsaved changes");
    // Keeping the edits closes the dialog and hands focus back to the deck button.
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(screen.getByText("Unsaved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByText("Unsaved")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Second/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps unsaved edits when the builder remounts", () => {
    const props = {
      cards: CARDS,
      owned: OWNED,
      decks: [DECK],
      userId: "user-1",
      dayKey: "2026-11-16",
      defaultFaction: "SHIROHANA" as const,
      onSave: () => Promise.resolve({ ok: true }),
      onDelete: () => Promise.resolve(true),
    };
    const { unmount } = render(<DeckBuilder {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Deck name" }), {
      target: { value: "Kept Draft" },
    });
    unmount();
    render(<DeckBuilder {...props} />);
    expect(
      (screen.getByRole("textbox", { name: "Deck name" }) as HTMLInputElement).value,
    ).toBe("Kept Draft");
    expect(screen.getByText("Unsaved")).toBeTruthy();
  });

  it("does not save a new deck without an owned card", () => {
    render(
      <DeckBuilder
        cards={CARDS}
        owned={OWNED}
        decks={[]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={() => Promise.resolve({ ok: true })}
        onDelete={() => Promise.resolve(true)}
      />,
    );
    const save = screen.getByRole("button", {
      name: "Save new deck",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Add at least one card you own/)).toBeTruthy();
    expect(screen.queryByText(/Save keeps the 0/)).toBeNull();
    expect(screen.getByRole("tab", { name: /Deck · 0\/25/ })).toBeTruthy();
  });

  it("saves only the owned copies of a deck previewed with a borrowed fill", async () => {
    const onSave = vi.fn((_input: KessenDeckSaveInput) =>
      Promise.resolve({ ok: true, deckId: "deck-1" }),
    );
    const kept = STARTER.cards.slice(0, 3);
    // Only the kept cards are owned, so the fill has to lend the rest.
    const keptOnly = {
      [STARTER.leaderId]: 1,
      ...Object.fromEntries(kept.map((entry) => [entry.itemId, entry.count])),
    };
    render(
      <DeckBuilder
        cards={CARDS}
        owned={keptOnly}
        decks={[{ ...DECK, cards: kept }]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={onSave}
        onDelete={() => Promise.resolve(true)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill with borrowed" }));
    expect(document.querySelector(".kh-dl-loan")).toBeTruthy();
    // The owned part is unchanged, so the preview alone leaves nothing to save.
    expect(
      (screen.getByRole("button", { name: "Save deck" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getAllByText(/Filled with borrowed copies \(LOAN\)\./)).toHaveLength(
      1,
    );
    expect(
      screen.getByText(/matches lend the other \d+ as borrowed copies/),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Deck name" }), {
      target: { value: "Short Deck" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const byId = (a: { itemId: string }, b: { itemId: string }) =>
      a.itemId.localeCompare(b.itemId);
    expect(
      [
        ...((onSave.mock.calls[0]?.[0] as KessenDeckSaveInput | undefined)?.cards ??
          []),
      ].sort(byId),
    ).toEqual([...kept].sort(byId));
  });
});

describe("DeckBuilder decks shelf", () => {
  const props = {
    cards: CARDS,
    owned: OWNED,
    userId: "user-1",
    dayKey: "2026-11-16",
    defaultFaction: "SHIROHANA" as const,
    onSave: () => Promise.resolve({ ok: true }),
    onDelete: () => Promise.resolve(true),
  };

  it("lists every saved deck by name and starts a new one from the shelf", () => {
    const other: KessenDeckRow = { ...DECK, id: "deck-2", name: "Second" };
    render(<DeckBuilder {...props} decks={[DECK, other]} />);
    const shelf = screen.getByRole("region", { name: "Your decks" });
    expect(within(shelf).getByText(`2 of ${KESSEN_MAX_DECKS} saved`)).toBeTruthy();
    expect(
      within(shelf).getByRole("button", { name: new RegExp(DECK.name) }),
    ).toBeTruthy();
    fireEvent.click(within(shelf).getByRole("button", { name: "New deck" }));
    // The new deck joins the shelf as the open entry until it is saved.
    const draft = within(shelf).getByRole("button", { name: /not saved yet/ });
    expect(draft.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Save new deck" })).toBeTruthy();
  });

  it("rests New deck at the deck cap and says how to make room", () => {
    const decks = Array.from({ length: KESSEN_MAX_DECKS }, (_, index) => ({
      ...DECK,
      id: `deck-${index}`,
      name: `Deck ${index}`,
    }));
    render(<DeckBuilder {...props} decks={decks} />);
    const shelf = screen.getByRole("region", { name: "Your decks" });
    expect(
      (within(shelf).getByRole("button", { name: "New deck" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(shelf).getByText(/delete one to start another/)).toBeTruthy();
  });
});

describe("DeckBuilder card column", () => {
  it("shows the tapped card in full with its copies and marks its keywords", () => {
    render(
      <DeckBuilder
        cards={CARDS}
        owned={OWNED}
        decks={[DECK]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={() => Promise.resolve({ ok: true })}
        onDelete={() => Promise.resolve(true)}
      />,
    );
    const detail = screen.getByRole("complementary", { name: "Card details" });
    const key = within(detail).getByRole("region", { name: "Keyword key" });
    // Every keyword is explained in the key.
    for (const keyword of KESSEN_KEYWORDS)
      expect(within(key).getByText(keyword)).toBeTruthy();
    const kawarimi = seedCardByName("Kawarimi");
    fireEvent.click(screen.getByRole("button", { name: /^Show Kawarimi\./ }));
    expect(
      within(detail).getByRole("article", { name: new RegExp(kawarimi.name) }),
    ).toBeTruthy();
    expect(within(detail).getByText(/in deck/)).toBeTruthy();
    const marked = [...key.querySelectorAll("[data-active] dt")].map(
      (term) => term.textContent,
    );
    expect(marked).toEqual(["Substitution"]);
    // A card in a set names it, so its Bond and Summon partners can be found.
    fireEvent.click(screen.getByRole("button", { name: /^Show Beta Sandworm\./ }));
    expect(within(detail).getByText("Sandworm")).toBeTruthy();
    // Keyboard focus on another tile previews it in the column.
    const fireball = seedCardByName("Fireball");
    fireEvent.focus(screen.getByRole("button", { name: /^Show Fireball\./ }));
    expect(
      within(detail).getByRole("article", { name: new RegExp(fireball.name) }),
    ).toBeTruthy();
  });
});

describe("DeckBuilder leader change", () => {
  it("asks before a new leader drops cards of another faction", async () => {
    const hyorinLeader = starterDeck("HYORIN").leaderId;
    const hyorinName = CARDS.find((card) => card.id === hyorinLeader)?.name ?? "";
    const startName = CARDS.find((card) => card.id === STARTER.leaderId)?.name ?? "";
    render(
      <DeckBuilder
        cards={CARDS}
        owned={{ ...OWNED, [hyorinLeader]: 1 }}
        decks={[DECK]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={() => Promise.resolve({ ok: true })}
        onDelete={() => Promise.resolve(true)}
      />,
    );
    const leader = screen.getByRole("combobox", { name: "Leader" });
    const pickLeader = async () => {
      fireEvent.keyDown(leader, { key: "ArrowDown" });
      const option = await screen.findByRole("option", {
        name: `${hyorinName} · Hyorin`,
      });
      await act(async () => fireEvent.keyDown(option, { key: "Enter" }));
    };
    await pickLeader();
    expect(screen.getByRole("dialog").textContent).toMatch(
      /Switching removes \d+ Shirohana/,
    );
    expect(leader.textContent).toContain(startName);
    fireEvent.click(screen.getByRole("button", { name: /^Keep / }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(leader));
    expect(screen.queryByText("Unsaved")).toBeNull();
    await pickLeader();
    fireEvent.click(screen.getByRole("button", { name: /^Switch and remove/ }));
    expect(leader.textContent).toContain(hyorinName);
    expect(screen.getByText(/of another faction left the deck/)).toBeTruthy();
  });
});

describe("DeckBuilder deletion", () => {
  it("leaves a deleted deck for a new draft instead of keeping its id", async () => {
    const onDelete = vi.fn((_deckId: string) => Promise.resolve(true));
    render(
      <DeckBuilder
        cards={CARDS}
        owned={OWNED}
        decks={[DECK]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={() => Promise.resolve({ ok: true })}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(`Delete “${DECK.name}”?`);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete deck" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("deck-1"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save new deck" })).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("CollectionBook", () => {
  it("greys unseen keywords and filters the book by a keyword", () => {
    render(
      <CollectionBook
        cards={CARDS}
        owned={OWNED}
        seenKeywords={["Rally"]}
        findContext={{ packs: PACKS, circuit: [] }}
      />,
    );
    const rally = screen.getByRole("button", { name: "Rally" });
    expect(rally.hasAttribute("data-seen")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Purge" }).hasAttribute("data-seen"),
    ).toBe(false);
    fireEvent.click(rally);
    expect(screen.getByRole("status").textContent).toContain("Rally");
    expect(screen.getAllByText(/Where to find/).length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("region", { name: "Forbidden shelf" })
        .querySelectorAll(".kh-niche"),
    ).toHaveLength(KESSEN_FORBIDDEN.length);
  });

  it("opens a set's page with every card in it, owned or not", () => {
    const owned = CARDS.find((card) => card.name === "Subaku Princess");
    if (!owned) throw new Error("missing Subaku Princess");
    render(
      <CollectionBook
        cards={CARDS}
        owned={{ [owned.id]: 1 }}
        seenKeywords={[]}
        findContext={{ packs: PACKS, circuit: [] }}
      />,
    );
    const chip = screen.getByRole("button", { name: "Subaku set: 1 of 2 collected" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("A Bond naming it counts");
    const page = screen.getByRole("tabpanel", { name: "Subaku set" });
    expect(
      within(page)
        .getAllByRole("img")
        .map((card) => card.getAttribute("aria-label")),
    ).toEqual(["Subaku Princess", "Subaku Winged Captain"]);
    expect(
      within(page).getAllByRole("button", { name: /^Where to find / }),
    ).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Shirohana:/ }));
    expect(screen.queryByRole("tabpanel", { name: "Subaku set" })).toBeNull();
  });
});

describe("CollectionBook faction tabs", () => {
  it("keeps one tab stop and moves between pages with the arrow keys", async () => {
    render(
      <CollectionBook
        cards={CARDS}
        owned={OWNED}
        seenKeywords={[]}
        findContext={{ packs: PACKS, circuit: [] }}
        initialFaction="SHIROHANA"
      />,
    );
    const tabs = screen.getAllByRole("tab");
    // Radix tabs: the list is the one tab stop and lands on the selected tab.
    expect(tabs.filter((tab) => tab.tabIndex === 0).length).toBeLessThanOrEqual(1);
    const first = tabs[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getAllByRole("tab")[1]!;
    await waitFor(() => expect(document.activeElement).toBe(second));
    fireEvent.focus(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(second, { key: "End" });
    const tabsAfter = screen.getAllByRole("tab");
    await waitFor(() =>
      expect(document.activeElement).toBe(tabsAfter[tabsAfter.length - 1] ?? null),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getAllByRole("tab")[0] ?? null),
    );
  }, 30_000);
});

describe("CollectionBook new cards", () => {
  it("marks cards first held since the last visit until their page is viewed", () => {
    const props = {
      cards: CARDS,
      seenKeywords: [],
      findContext: { packs: PACKS, circuit: [] },
      initialFaction: "SHIROHANA" as const,
      viewerId: "viewer-1",
    };
    // The first visit records the collection, so nothing is marked.
    const { unmount } = render(<CollectionBook {...props} owned={OWNED} />);
    expect(document.querySelectorAll(".kc-new")).toHaveLength(0);
    unmount();
    const hyorin = CARDS.find(
      (card) =>
        card.faction === "HYORIN" &&
        card.kind !== "LEADER" &&
        card.variant === "STANDARD" &&
        !(card.id in OWNED),
    );
    if (!hyorin) throw new Error("missing Hyorin card");
    render(<CollectionBook {...props} owned={{ ...OWNED, [hyorin.id]: 1 }} />);
    const tab = screen.getByRole("tab", { name: /^Hyorin: .*, 1 new$/ });
    fireEvent.mouseDown(tab);
    expect(screen.getByRole("tab", { name: /^Hyorin: \d+ of \d+ collected$/ })).toBe(
      tab,
    );
    expect(
      screen.getByRole("img", { name: hyorin.name }).querySelector(".kc-new"),
    ).toBeTruthy();
  });

  it("opens one Where to find popover at a time", async () => {
    render(
      <CollectionBook
        cards={CARDS}
        owned={OWNED}
        seenKeywords={[]}
        findContext={{ packs: PACKS, circuit: [] }}
        initialFaction="HYORIN"
      />,
    );
    const toggles = screen.getAllByRole("button", { name: /^Where to find / });
    fireEvent.click(toggles[0]!);
    await waitFor(() => expect(toggles[0]!.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.click(toggles[1]!);
    await waitFor(() => expect(toggles[1]!.getAttribute("aria-expanded")).toBe("true"));
    expect(toggles[0]!.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("HallHeader", () => {
  it("states the weekly pack condition and labels the provision figure", () => {
    render(
      <HallHeader
        today={{
          rewarded: 1,
          rewardedCap: 12,
          drops: 0,
          dropsCap: 5,
        }}
        week={{ firstWinPack: true }}
        deck={{
          id: "deck-1",
          name: "Kirigakure Frostbound Shadow Vanguard XI",
          faction: "HYORIN",
          leaderName: "Kimiko",
          provision: 132,
          budget: 161,
          cards: 25,
          ready: true,
          fillable: false,
          problem: null,
        }}
        onDeckClick={() => undefined}
      />,
    );
    expect(screen.getByText("win 1 match")).toBeTruthy();
    expect(screen.getByText("Paper Bundle")).toBeTruthy();
    const chip = screen.getByRole("button", { name: /^Deck Kirigakure/ });
    expect(chip.textContent).toContain("Provision 132/161");
    expect(chip.querySelector("[data-deck-name]")?.getAttribute("title")).toBe(
      "Kirigakure Frostbound Shadow Vanguard XI",
    );
  });

  it("counts down to the weekly reset once the week's pack is claimed", () => {
    render(
      <HallHeader
        today={{ rewarded: 3, rewardedCap: 12, drops: 1, dropsCap: 5 }}
        week={{ firstWinPack: false }}
        deck={null}
      />,
    );
    const weekly = screen.getByText("Paper Bundle").closest("li");
    expect(weekly?.hasAttribute("data-done")).toBe(true);
    expect(weekly?.textContent).toContain("claimed");
    expect(weekly?.textContent).toMatch(/next in\s*\d+(d|h|m)/);
  });
});

describe("CircuitMap", () => {
  it("labels pins with wins and the Ascended rematch and describes them in the strip", () => {
    const hisame = circuitEntry("hisame", {
      firstWinAt: new Date("2026-11-10T00:00:00Z"),
      wins: 1,
      ascendedLockReason: null,
    });
    render(
      <CircuitMap
        circuit={[circuitEntry("lemu"), hisame]}
        cards={CARDS}
        packs={PACKS}
        activeMatch={{ ...LIVE_MATCH, npcKey: "hisame" }}
        onSelect={() => undefined}
      />,
    );
    const [pin] = screen.getAllByRole("button", { name: /^Hisame, Dune Warden/ });
    expect(pin?.getAttribute("aria-label")).toMatch(
      /Beaten, 1 win\. Ascended rematch open, Jonin\..*select to resume/,
    );
    fireEvent.focus(screen.getAllByRole("button", { name: /^Lemu,/ })[0]!);
    const strip = document.querySelector(".kh-map-info");
    expect(strip?.textContent).toContain("Lemu · ");
    fireEvent.blur(screen.getAllByRole("button", { name: /^Lemu,/ })[0]!);
    // Without a preview the strip describes the live match.
    expect(strip?.textContent).toContain("Hisame · Dune Warden");
    expect(strip?.textContent).toContain("select to resume");
    expect(strip?.textContent).toContain("Ascended rematch open");
    // The open Ascended rematch's first win carries the gift on the pin; the map is the
    // only view of the Circuit, at every width.
    expect(
      screen.getAllByRole("button", { name: /^Hisame, Dune Warden/ }),
    ).toHaveLength(1);
    expect(pin?.getAttribute("aria-label")).toContain(
      "Ascended first win: one of Subaku Winged Captain or Amaterasu's Holy Mirror",
    );
    expect(pin?.querySelector(".kh-pin-reward")).toBeTruthy();
  });
  it("marks a first-win card still to choose and keys the Ascended beaten mark", () => {
    const hisame = circuitEntry("hisame", {
      firstWinAt: new Date("2026-11-10T00:00:00Z"),
      ascendedFirstWinAt: new Date("2026-11-12T00:00:00Z"),
      ascendedLockReason: null,
      wins: 2,
    });
    render(
      <CircuitMap
        circuit={[circuitEntry("lemu", { firstWinAt: new Date() }), hisame]}
        cards={CARDS}
        packs={PACKS}
        pendingPicks={[{ matchId: "match-pick", npcKey: "hisame" }]}
        onSelect={() => undefined}
      />,
    );
    const [pin] = screen.getAllByRole("button", { name: /^Hisame, Dune Warden/ });
    expect(pin?.getAttribute("aria-label")).toMatch(
      /Ascended rematch beaten\. First-win reward waiting to be chosen$/,
    );
    expect(pin?.querySelector(".kh-pin-reward")).toBeTruthy();
    const [lemuPin] = screen.getAllByRole("button", { name: /^Lemu,/ });
    expect(lemuPin?.querySelector(".kh-pin-reward")).toBeNull();
    const legend = document.querySelector(".kh-map-legend");
    expect(legend?.textContent).toContain("Ascended beaten");
    expect(legend?.textContent).not.toContain("Ascended rematch open");
    expect(legend?.textContent).toContain("First-win reward");
  });
  it("fits a phone-wide map with name plates in hand only and zooms with its buttons", () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 360,
    });
    try {
      render(
        <CircuitMap
          circuit={[circuitEntry("lemu"), circuitEntry("hisame")]}
          cards={CARDS}
          packs={PACKS}
          selectedKey="hisame"
          onSelect={() => undefined}
        />,
      );
      const frame = document.querySelector<HTMLElement>(".kh-map");
      const layer = document.querySelector<HTMLElement>(".kh-map-layer");
      expect(frame?.style.getPropertyValue("--kh-pin-scale")).toBe("0.500");
      expect(frame?.hasAttribute("data-compact")).toBe(true);
      expect(document.body.textContent).not.toContain("Swipe");
      const zoomOut = screen.getByRole("button", { name: "Zoom out" });
      const reset = screen.getByRole("button", { name: "Show the whole map" });
      expect(zoomOut).toHaveProperty("disabled", true);
      expect(reset).toHaveProperty("disabled", true);
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(layer?.style.width).toBe("150%");
      expect(frame?.hasAttribute("data-zoomed")).toBe(true);
      expect(frame?.hasAttribute("data-compact")).toBe(false);
      expect(zoomOut).toHaveProperty("disabled", false);
      fireEvent.click(reset);
      expect(layer?.style.width).toBe("100%");
      expect(layer?.style.transform).toMatch(/^translate3d\(0%, 0%, 0(px)?\)$/);
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });
});

describe("PacksPanel", () => {
  it("orders packs by kind and points an empty tray to the stall", () => {
    const pack = (itemId: string, name: string) => ({
      userItemId: itemId,
      itemId,
      name,
      quantity: 1,
    });
    const { unmount } = render(
      <PacksPanel
        packs={[
          pack("kessen-pack-lacquer", "Lacquer Case"),
          pack("kessen-pack-village-hyorin", "Hyorin Village Bundle"),
          pack("kessen-pack-paper", "Paper Bundle"),
        ]}
        pity={null}
        onOpen={() => undefined}
        onAutoSellChange={() => undefined}
      />,
    );
    expect(
      [...document.querySelectorAll("[data-pack-name]")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Paper Bundle", "Hyorin Village Bundle", "Lacquer Case"]);
    expect(screen.getByText(/beyond the copy limit/)).toBeTruthy();
    expect(
      screen.getByText(/Forbidden copies and leaders are never sold/),
    ).toBeTruthy();
    unmount();
    render(
      <PacksPanel
        packs={[]}
        pity={null}
        onOpen={() => undefined}
        stall={<p>Stall</p>}
      />,
    );
    expect(screen.getByRole("button", { name: "Visit the Card Master" })).toBeTruthy();
  });
});

describe("Pack odds", () => {
  it("formats odds with one decimal from 1 % and two below", () => {
    expect(formatOdds(ODDS.normal, "COMMON")).toBe("76%");
    expect(formatOdds(ODDS.normal, "RARE")).toBe("19.4%");
    expect(formatOdds(ODDS.normal, "LEGENDARY")).toBe("0.59%");
    expect(formatOdds(ODDS.normal, "FORBIDDEN")).toBe("0.01%");
    expect(formatOdds(ODDS.rareSlot, "LEGENDARY")).toBe("2%");
    expect(formatOdds(ODDS.rareSlot, "COMMON")).toBe("–");
  });
});

describe("DeckBuilder listings", () => {
  it("captions a card whose copies are all listed at the auction house", () => {
    const listedCard = CARDS.find(
      (card) => card.id === STARTER.cards[0]?.itemId && card.kind !== "LEADER",
    );
    if (!listedCard) throw new Error("missing starter card");
    const { [listedCard.id]: _free, ...rest } = OWNED;
    render(
      <DeckBuilder
        cards={CARDS}
        owned={rest}
        listed={{ [listedCard.id]: 1 }}
        decks={[]}
        userId="user-1"
        dayKey="2026-11-16"
        defaultFaction="SHIROHANA"
        onSave={() => undefined}
        onDelete={() => Promise.resolve(true)}
      />,
    );
    const link = screen.getByRole("link", { name: "Listed at the auction house" });
    expect(link.getAttribute("href")).toBe("/auctionhouse");
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Show ${listedCard.name}\\.`) }),
    );
    // The card column names the listing and why the card cannot join the deck.
    const detail = screen.getByRole("complementary", { name: "Card details" });
    expect(within(detail).getByText("1 listed at the auction house")).toBeTruthy();
    expect(
      within(detail).getByText("Your copies are listed at the auction house."),
    ).toBeTruthy();
    expect(link.isConnected).toBe(true);
  });
});

describe("CollectionBook listings", () => {
  it("counts copies listed in the auction house as owned", () => {
    const cryverin = seedCardByName("Cryverin");
    const { [cryverin.id]: _free, ...rest } = OWNED;
    render(
      <CollectionBook
        cards={CARDS}
        owned={rest}
        listed={{ [cryverin.id]: 1 }}
        seenKeywords={[]}
        findContext={{ packs: PACKS, circuit: [] }}
        initialFaction={cryverin.faction}
      />,
    );
    const inspect = screen.getByRole("img", { name: cryverin.name });
    const card = inspect.closest(".kh-book-card");
    expect(card?.hasAttribute("data-owned")).toBe(true);
    expect(card?.textContent).toContain("Listed");
  });

  it("counts surplus from the copies that are not listed", () => {
    const mirror = seedCardByName("Amaterasu's Holy Mirror");
    const limit = KESSEN_COPY_LIMITS[mirror.rarity];
    render(
      <CollectionBook
        cards={CARDS}
        owned={{ ...OWNED, [mirror.id]: limit + 2 }}
        listed={{ [mirror.id]: 1 }}
        seenKeywords={[]}
        findContext={{ packs: PACKS, circuit: [] }}
        initialFaction={mirror.faction}
      />,
    );
    const card = screen
      .getByRole("img", { name: mirror.name })
      .closest(".kh-book-card");
    expect(card?.textContent).toContain("Listed");
    expect(card?.textContent).toContain("+2 surplus");
  });
});

describe("PackOpening", () => {
  const reveal: CardPackReveal = {
    packItemId: "kessen-pack-paper",
    cards: [
      {
        itemId: seedCardByName("Moonprowler").id,
        rarity: "COMMON",
        forbidden: false,
        isNew: false,
        surplus: true,
        soldFor: null,
      },
      {
        itemId: seedCardByName("Cryverin").id,
        rarity: "COMMON",
        forbidden: false,
        isNew: false,
        surplus: true,
        soldFor: 50,
      },
      {
        itemId: seedCardByName("Owlcat").id,
        rarity: "COMMON",
        forbidden: false,
        isNew: true,
        surplus: false,
        soldFor: null,
      },
      {
        itemId: seedCardByName("Kajioka").id,
        rarity: "COMMON",
        forbidden: false,
        isNew: true,
        surplus: false,
        soldFor: null,
      },
      {
        itemId: KESSEN_FORBIDDEN[0]?.id ?? "",
        rarity: "LEGENDARY",
        forbidden: true,
        isNew: true,
        surplus: false,
        soldFor: null,
      },
    ],
    pity: { epicIn: 4, legendaryIn: 23 },
  };

  it("flips cards one by one or all at once and reports surplus and pity", async () => {
    const onClose = vi.fn();
    render(
      <PackOpening
        open
        reveal={reveal}
        cards={CARDS}
        packName="Paper Bundle"
        onClose={onClose}
        motion={false}
      />,
    );
    // The counters are read after the opening, so they wait for the reveal.
    expect(screen.queryByText("Legendary within 23 packs")).toBeNull();
    const first = screen.getByRole("button", {
      name: "Card 1 of 5, face down, tap to reveal",
    });
    fireEvent.click(first);
    expect(first.hasAttribute("data-flipped")).toBe(true);
    expect(screen.getByText("Surplus")).toBeTruthy();
    // A revealed card opens full size; closing returns to the fan.
    fireEvent.click(first);
    const back = await screen.findByRole("button", { name: "Back to the pack" });
    expect(
      screen.getByText("Surplus copy: kept in your inventory to sell"),
    ).toBeTruthy();
    fireEvent.click(back);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Back to the pack" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal all" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done" })).toBeTruthy(),
    );
    expect(screen.getByText("+50 ryo")).toBeTruthy();
    expect(
      screen.getByText("A Forbidden card! 3 new cards · 50 ryo from surplus."),
    ).toBeTruthy();
    expect(screen.getByText("Legendary within 23 packs")).toBeTruthy();
    expect(screen.getByText(/extra copy waits in your inventory/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("plays in place on the page or in a dialog over it", () => {
    const { unmount } = render(
      <PackOpening
        open
        layout="inline"
        reveal={reveal}
        cards={CARDS}
        packName="Paper Bundle"
        onClose={() => undefined}
        motion={false}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const stage = screen.getByRole("region", { name: "Paper Bundle" });
    expect(stage.contains(document.activeElement)).toBe(true);
    unmount();
    render(
      <PackOpening
        open
        reveal={reveal}
        cards={CARDS}
        packName="Paper Bundle"
        onClose={() => undefined}
        motion={false}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Paper Bundle" })).toBeTruthy();
  });

  it("deals the rarest pull last and ends on the counters alone", async () => {
    render(
      <PackOpening
        open
        reveal={{
          ...reveal,
          cards: [reveal.cards[4]!, ...reveal.cards.slice(0, 4)],
          pity: { epicIn: 8, legendaryIn: 40 },
        }}
        cards={CARDS}
        packName="Paper Bundle"
        onClose={() => undefined}
        motion={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Card 5 of 5, face down, tap to reveal" }),
    );
    expect(
      screen
        .getAllByRole("button", { name: /Open full size$/ })[0]
        ?.getAttribute("data-tier"),
    ).toBe("FORBIDDEN");
    fireEvent.click(screen.getByRole("button", { name: "Reveal all" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done" })).toBeTruthy(),
    );
    expect(screen.getByText(/Legendary within 40 packs/)).toBeTruthy();
    expect(screen.queryByText(/pity reset/i)).toBeNull();
  });

  it("counts the best pulls when several share the top rarity", async () => {
    const epic = (itemId: string) => ({
      itemId,
      rarity: "EPIC" as const,
      forbidden: false,
      isNew: true,
      surplus: false,
      soldFor: null,
    });
    const epics = CARDS.filter(
      (card) => card.rarity === "EPIC" && card.kind !== "LEADER",
    );
    render(
      <PackOpening
        open
        reveal={{
          ...reveal,
          packItemId: "kessen-pack-first",
          cards: [
            ...reveal.cards.slice(0, 3),
            epic(epics[0]?.id ?? ""),
            epic(epics[1]?.id ?? ""),
          ],
        }}
        cards={CARDS}
        packName="First Bundle"
        onClose={() => undefined}
        motion={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal all" }));
    await waitFor(() =>
      expect(
        screen.getByText("Your first Epics. Find them in your Collection."),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/^Two epic pulls\. /)).toBeTruthy();
  });

  it("states the First Bundle guarantee, then welcomes the player to the table", async () => {
    render(
      <PackOpening
        open
        reveal={{
          ...reveal,
          packItemId: "kessen-pack-first",
          pity: { epicIn: 7, legendaryIn: 39 },
        }}
        cards={CARDS}
        packName="First Bundle"
        onClose={() => undefined}
        motion={false}
      />,
    );
    expect(
      screen.getByText("An Epic or better is guaranteed in this bundle."),
    ).toBeTruthy();
    expect(screen.queryByText(/Epic within/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reveal all" }));
    await waitFor(() =>
      expect(screen.getByText(/Find it in your Collection\./)).toBeTruthy(),
    );
    expect(screen.queryByText("Epic pity reset")).toBeNull();
    expect(screen.queryByText(/Epic within/)).toBeNull();
    const toTable = screen.getByRole("button", { name: "To the table" });
    expect(toTable.className).toContain("bg-primary");
  });
});
