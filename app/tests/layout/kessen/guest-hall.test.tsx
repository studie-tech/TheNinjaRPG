import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as navigation from "next/navigation";
import KessenPage from "@/app/[shell]/kessen/page";
import * as kessenHub from "@/hooks/kessen/useKessenHub";
import { KESSEN_ACADEMY } from "@/libs/kessen/academy";
import { KESSEN_NPCS } from "@/libs/kessen/npcs";
import * as userContext from "@/utils/UserContext";
import type { KessenCatalogEntry } from "@/validators/kessen";
import { KESSEN_SEED_CATALOG } from "../../libs/kessen/fixtures/catalog";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const CARDS: KessenCatalogEntry[] = KESSEN_SEED_CATALOG.map((card) => ({
  ...card,
  image: "",
  artUrl: "",
  focalX: 50,
  focalY: 30,
  flavor: "",
  abilityName: null,
  number: null,
}));

let session = { isSignedIn: false, isClerkLoaded: true };
let catalogFetched = 0;
let searchParams = new URLSearchParams();
let replaceRoute = vi.fn();

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  session = { isSignedIn: false, isClerkLoaded: true };
  catalogFetched = 0;
  searchParams = new URLSearchParams();
  replaceRoute = vi.fn();
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    push: vi.fn(),
    replace: replaceRoute,
  } as never);
  vi.spyOn(navigation, "useSearchParams").mockImplementation(
    () => searchParams as never,
  );
  // A signed-out visitor: no profile, only the public catalog. Any other tRPC hook would
  // need a provider this suite does not give, so the guest hall is shown to read nothing
  // else from the server.
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(
    () =>
      ({
        data: undefined,
        status: "pending",
        isClerkLoaded: session.isClerkLoaded,
        isSignedIn: session.isSignedIn,
        refreshUser: vi.fn(),
        timeDiff: 0,
      }) as never,
  );
  vi.spyOn(kessenHub, "useKessenCatalog").mockImplementation(() => {
    catalogFetched++;
    return {
      data: { fingerprint: "test", cards: CARDS, packs: [] },
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never;
  });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("Kessen for signed-out visitors", () => {
  it("opens the shared Rules tab by URL and offers a return to play", async () => {
    searchParams.set("tab", "rules");
    const view = render(<KessenPage />);
    expect(
      await view.findByRole("heading", { name: "How a match works" }),
    ).toBeTruthy();
    const sections = view.getByRole("navigation", { name: "Card Hall sections" });
    expect(within(sections).getByRole("button", { name: "Rules" })).toBeTruthy();
    expect(view.queryByRole("link", { name: "Balance report" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Play Kessen" }));
    expect(replaceRoute).toHaveBeenCalledWith("/kessen", { scroll: false });
  });

  it("shows the guest hall: every lesson, every Circuit opponent and the locked sections", async () => {
    const view = await renderGuestHall();
    expect(view.getByRole("link", { name: "Rules" }).getAttribute("href")).toBe(
      "/kessen?tab=rules",
    );
    const hero = view.getByRole("region", { name: "Kessen: play for free" });
    expect(hero.nextElementSibling).toBe(
      view.getByRole("region", { name: "Keep cards and ryo" }),
    );
    expect(view.getByRole("link", { name: "Join to earn" }).getAttribute("href")).toBe(
      "/signup",
    );
    expect(view.getByRole("heading", { name: "Lemu's Academy" })).toBeTruthy();
    for (const lesson of KESSEN_ACADEMY) {
      const start = view.getByRole("button", {
        name: `Start lesson ${lesson.order}, ${lesson.title}`,
      });
      expect((start as HTMLButtonElement).disabled).toBe(false);
    }
    for (const npc of KESSEN_NPCS) {
      expect(
        view.getByRole("button", { name: new RegExp(`^Play ${npc.name}, `) }),
      ).toBeTruthy();
    }
    expect(view.getByRole("group", { name: "Your deck" })).toBeTruthy();
    const locked = view.getByRole("region", { name: "Keep what you win" });
    for (const text of [
      "Log in to keep the cards you win",
      "Log in to build your own decks",
      "Log in to open packs",
      "Log in to challenge players",
    ]) {
      const tile = within(locked).getByText(text).closest("a");
      expect(tile?.getAttribute("href")).toBe("/login");
    }
    expect(catalogFetched).toBeGreaterThan(0);
  });

  it("keeps every table shut until sign-in is confirmed", async () => {
    session = { isSignedIn: false, isClerkLoaded: false };
    const view = await renderGuestHall();
    const first = KESSEN_ACADEMY[0];
    const start = view.getByRole("button", {
      name: `Start lesson 1, ${first?.title}`,
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(
      (view.getByRole("button", { name: "Play now, free" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const play = view.getByRole("button", {
      name: /^Play Kazehiko, /,
    }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
  });

  it("switches the loaner faction the practice matches use", async () => {
    const view = await renderGuestHall();
    const hyorin = view.getByRole("radio", { name: "Hyorin" });
    fireEvent.click(hyorin);
    expect((hyorin as HTMLInputElement).checked).toBe(true);
    expect(view.getByText("Hyorin", { selector: "strong" })).toBeTruthy();
  });
});

/** The page with its guest hall, which loads as its own chunk. */
const renderGuestHall = async () => {
  const view = render(<KessenPage />);
  await view.findByText("Free to play in your browser");
  return view;
};
