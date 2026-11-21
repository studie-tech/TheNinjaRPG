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

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  session = { isSignedIn: false, isClerkLoaded: true };
  catalogFetched = 0;
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
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
  it("shows the guest hall: every lesson, every Circuit opponent and the locked sections", () => {
    const view = render(<KessenPage />);
    expect(view.getByText("Free to play in your browser")).toBeTruthy();
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

  it("keeps every table shut until sign-in is confirmed", () => {
    session = { isSignedIn: false, isClerkLoaded: false };
    const view = render(<KessenPage />);
    const first = KESSEN_ACADEMY[0];
    const start = view.getByRole("button", {
      name: `Start lesson 1, ${first?.title}`,
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    const play = view.getByRole("button", {
      name: /^Play Kazehiko, /,
    }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
  });

  it("switches the loaner faction the practice matches use", () => {
    const view = render(<KessenPage />);
    const hyorin = view.getByRole("radio", { name: "Hyorin" });
    fireEvent.click(hyorin);
    expect((hyorin as HTMLInputElement).checked).toBe(true);
    expect(view.getByText("Hyorin", { selector: "strong" })).toBeTruthy();
  });
});
