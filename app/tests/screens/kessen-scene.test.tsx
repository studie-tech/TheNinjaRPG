import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as dynamic from "next/dynamic";
import * as navigation from "next/navigation";
import { api } from "@/app/_trpc/client";
import * as Collection from "@/hooks/kessen/useKessenCollection";
import * as Duel from "@/hooks/kessen/useKessenDuel";
import * as Hub from "@/hooks/kessen/useKessenHub";
import * as Match from "@/hooks/kessen/useKessenMatch";
import * as Lobby from "@/hooks/kessen/useKessenPvpLobby";
import * as screenNavigation from "@/hooks/navigation";
import * as ContentBox from "@/layout/ContentBox";
import * as DuelsPanel from "@/layout/kessen/hub/DuelsPanel";
import { KessenRules } from "@/layout/kessen/KessenRules";
import * as Motion from "@/layout/kessen/useKessenMotion";
import * as Link from "@/layout/Link";
import { academyProgress } from "@/libs/kessen/academy";
import type { KessenHub } from "@/validators/kessen";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { mockUserContextValue } from "../setup/userContext";

function DuelTable({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose}>
      Close duel table
    </button>
  );
}

const actualDynamic = dynamic.default;
const dynamicSpy = vi.spyOn(dynamic, "default").mockImplementation((...args) => {
  const loader = String(args[0]);
  if (loader.includes("/kessen/KessenRules")) return KessenRules as never;
  if (loader.includes("/kessen/match/MatchView")) return DuelTable as never;
  return actualDynamic(...args);
});
const { KessenScreen } = await import("@/screens/kessen/KessenScreen");
dynamicSpy.mockRestore();

const hub: KessenHub = {
  progress: {
    lessonCompleted: true,
    starterGranted: true,
    starterFaction: null,
    seenKeywords: [],
  },
  owned: {},
  listed: {},
  packs: [],
  decks: [],
  circuit: [],
  today: { rewarded: 0, rewardedCap: 5, drops: 0, dropsCap: 5 },
  week: { firstWinPack: false },
  activeMatch: null,
  pendingPicks: [],
  academy: academyProgress({}, null),
  homeFaction: null,
  loanerFaction: "AKASUMI",
  needsLesson: false,
  needsStarter: false,
  pity: { epicIn: 1, legendaryIn: 1 },
  autoSellSurplus: false,
};
let params: URLSearchParams;
let onMatchFound: (id: string) => void;
let duelLoaded: boolean;
let client: QueryClient;

beforeEach(() => {
  installBrowserGlobals();
  localStorage.clear();
  params = new URLSearchParams();
  duelLoaded = false;
  client = new QueryClient();
  mockUserContextValue({
    data: { userId: "player", role: "USER" },
    isClerkLoaded: true,
    isSignedIn: true,
  });
  vi.spyOn(navigation, "useSearchParams").mockImplementation(() => params as never);
  vi.spyOn(screenNavigation, "useNavigationRouter").mockReturnValue({
    replace: vi.fn(),
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent, onBack }) => (
      <section>
        {onBack ? (
          <button type="button" onClick={onBack}>
            Back to hall
          </button>
        ) : null}
        {topRightContent}
        {children}
      </section>
    ),
  );
  vi.spyOn(Link, "default").mockImplementation(({ children, href, ...props }) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ));
  const catalog = { data: { cards: [], packs: [] } };
  vi.spyOn(Hub, "useKessenHub").mockReturnValue({
    hub: { data: hub },
    catalog,
  } as never);
  vi.spyOn(Hub, "useKessenCatalog").mockReturnValue(catalog as never);
  vi.spyOn(Hub, "useStartKessenMatch").mockReturnValue({} as never);
  vi.spyOn(Collection, "useKessenCollection").mockReturnValue({} as never);
  vi.spyOn(Motion, "useKessenMotion").mockReturnValue(false);
  vi.spyOn(Match, "useKessenMatch").mockReturnValue({ match: null } as never);
  vi.spyOn(Lobby, "useKessenPvpLobby").mockReturnValue({
    lobby: { data: { activeMatch: null, challenges: [], queue: { queuedAt: 1 } } },
  } as never);
  vi.spyOn(Lobby, "useRankedQueuePolling").mockImplementation((_lobby, found) => {
    onMatchFound = found;
    return { message: null, clearMessage: vi.fn() };
  });
  vi.spyOn(Duel, "useKessenDuel").mockImplementation(
    (id) =>
      ({
        isPending: !!id && !duelLoaded,
        match:
          id && duelLoaded
            ? {
                id,
                kind: "RANKED",
                seat: 0,
                players: [{ userId: "player" }, { userId: "opponent" }],
              }
            : null,
      }) as never,
  );
  vi.spyOn(DuelsPanel, "DuelsPanel").mockReturnValue(<p>Ranked duel lobby</p>);
});

afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

function Screen() {
  return (
    <api.Provider client={api.createClient({ links: [] })} queryClient={client}>
      <QueryClientProvider client={client}>
        <KessenScreen />
      </QueryClientProvider>
    </api.Provider>
  );
}

it("opens a ranked match found while reading Rules and closes to the duel lobby", () => {
  localStorage.setItem("kessenTab", "Duels");
  const view = render(<Screen />);
  fireEvent.click(view.getByRole("button", { name: "Rules" }));
  expect(view.getByRole("button", { name: "Play Kessen" })).toBeTruthy();

  act(() => onMatchFound("ranked-duel"));
  expect(view.getByText("Loading your duel")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Play Kessen" })).toBeNull();
  duelLoaded = true;
  view.rerender(<Screen />);
  fireEvent.click(view.getByRole("button", { name: "Close duel table" }));
  expect(view.getByText("Ranked duel lobby")).toBeTruthy();
  expect(view.getByRole("button", { name: "Duels" }).getAttribute("aria-current")).toBe(
    "true",
  );
});

it("returns a Rules section link to Rules after leaving the matched duel", () => {
  params.set("tab", "rules");
  const view = render(<Screen />);
  expect(view.getByRole("button", { name: "Play Kessen" })).toBeTruthy();
  act(() => onMatchFound("ranked-duel"));
  expect(view.getByText("Loading your duel")).toBeTruthy();
  duelLoaded = true;
  view.rerender(<Screen />);
  expect(view.getByRole("button", { name: "Close duel table" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Back to hall" }));
  expect(view.getByRole("button", { name: "Play Kessen" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Rules" }).getAttribute("aria-current")).toBe(
    "true",
  );
});
