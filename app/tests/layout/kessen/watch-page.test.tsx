import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import { Suspense } from "react";
import KessenWatchPage from "@/app/[shell]/kessen/watch/[matchid]/page";
import * as kessenDuel from "@/hooks/kessen/useKessenDuel";
import * as kessenHub from "@/hooks/kessen/useKessenHub";
import * as userContext from "@/utils/UserContext";
import type { KessenPvpMatchPayload, KessenPvpPlayer } from "@/validators/kessen";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

let router = { push: vi.fn(), replace: vi.fn() };

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  router = { push: vi.fn(), replace: vi.fn() };
  vi.spyOn(navigation, "useRouter").mockReturnValue(router as never);
  vi.spyOn(userContext, "useRequiredUserInfo").mockReturnValue({
    data: "viewer",
  } as never);
  // The catalog stays loading, so the table itself never mounts in this suite.
  vi.spyOn(kessenHub, "useKessenCatalog").mockReturnValue({
    data: undefined,
    error: null,
    isFetching: true,
    refetch: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("Watching a Kessen duel", () => {
  it("sends a player seated in the live duel to their own table", async () => {
    const view = await renderWatch(duel({ players: [player("viewer"), player("b")] }));
    expect(router.replace).toHaveBeenCalledWith("/kessen?tab=duels");
    expect(view.getByText("Taking your seat")).toBeTruthy();
  });

  it("keeps other players and seated players of a finished duel watching", async () => {
    await renderWatch(duel({ players: [player("a"), player("b")] }));
    await renderWatch(
      duel({ status: "CONCEDED", players: [player("viewer"), player("b")] }),
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});

/** The page for one watched duel, with its route params resolved. */
const renderWatch = async (match: KessenPvpMatchPayload) => {
  vi.spyOn(kessenDuel, "useWatchedKessenDuel").mockReturnValue({
    data: { match, log: null },
    match,
    log: null,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  } as never);
  const params = Promise.resolve({ matchid: match.id });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={null}>
        <KessenWatchPage params={params} />
      </Suspense>,
    );
  });
  return view;
};

const player = (userId: string): KessenPvpPlayer => ({
  userId,
  username: userId,
  avatar: null,
  level: 1,
  villageName: null,
  rating: null,
});

const duel = (patch: Partial<KessenPvpMatchPayload>): KessenPvpMatchPayload =>
  ({
    id: "duel-1",
    kind: "FRIENDLY",
    status: "ACTIVE",
    ...patch,
  }) as KessenPvpMatchPayload;
