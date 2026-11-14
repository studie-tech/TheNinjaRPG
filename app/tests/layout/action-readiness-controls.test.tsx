import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as nextNavigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import TerritoryWarPage from "@/app/[shell]/territory-war/page";
import * as navigation from "@/hooks/navigation";
import * as ContentBox from "@/layout/ContentBox";
import { ClanBattles } from "@/layout/clan/ClanBattles";
import * as Image from "@/layout/Image";
import * as Link from "@/layout/Link";
import { mockUserContextValue } from "../setup/userContext";

let actor: Record<string, unknown>;
const mutate = vi.fn(async () => ({ success: false }));
const invalidate = async () => {};
const util = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => ({ invalidate }) }) },
);
beforeEach(() => {
  actor = {
    userId: "actor",
    username: "Actor",
    status: "AWAKE",
    autoWakeUp: true,
    sector: 100,
    clanId: "home",
    rank: "JONIN",
    isOutlaw: false,
  };
  mutate.mockReset().mockResolvedValue({ success: false });
  const mutation = {
    useMutation: () => ({ mutate, mutateAsync: mutate, isPending: false }),
  };
  const event = {
    id: "event",
    sector: 100,
    endsAt: new Date(Date.now() + 3600000),
    resolvedAt: null,
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => util,
    territoryWar: {
      getCurrent: {
        useQuery: () => ({
          data: {
            event,
            competitor: { name: "Home" },
            teams: [
              { id: "team", queue: [{ userId: "other", user: { username: "Other" } }] },
            ],
          },
          isLoading: false,
        }),
      },
      createTeam: mutation,
      joinTeam: mutation,
      leaveTeam: mutation,
      startBattle: mutation,
    },
    clan: {
      getClanBattles: {
        useQuery: () => ({
          data: [
            {
              id: "clan-battle",
              createdAt: new Date(),
              winnerId: null,
              battleId: null,
              attackerClan: { id: "home", name: "Home", image: "" },
              defenderClan: { id: "away", name: "Away", image: "" },
              queue: [],
            },
          ],
        }),
      },
      deleteClanBattle: mutation,
      challengeClan: mutation,
      joinClanBattle: mutation,
      leaveClanBattle: mutation,
      kickFromClanBattle: mutation,
      initiateClanBattle: mutation,
    },
  });
  mockUserContextValue({
    data: actor,
    timeDiff: 0,
    updateUser: async () => true,
    prepareUserUpdate: (() => 1) as never,
    pusher: undefined,
  });
  vi.spyOn(nextNavigation, "useRouter").mockReturnValue({
    push: vi.fn(),
    prefetch: vi.fn(),
  } as never);
  vi.spyOn(nextNavigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  vi.spyOn(nextNavigation, "usePathname").mockReturnValue("/clanhall");
  vi.spyOn(Link, "default").mockImplementation(({ href, children }) => (
    <a href={String(href)}>{children}</a>
  ));
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({
    push: vi.fn(),
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
for (const status of ["AWAKE", "ASLEEP", "HOSPITALIZED"] as const) {
  it(`Territory War explicit controls admit eligible ${status}`, () => {
    actor.status = status;
    const view = render(<TerritoryWarPage />);
    const create = view.getByRole("button", {
      name: "Create guardian team",
    }) as HTMLButtonElement;
    const join = view.getByRole("button", { name: "Join team" }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    expect(join.disabled).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(create);
    expect(mutate).toHaveBeenCalledWith({ eventId: "event" });
    fireEvent.click(join);
    expect(mutate).toHaveBeenCalledWith({ teamId: "team" });
  });
  it(`Clan battle direct join controls admit eligible ${status}`, async () => {
    actor.status = status;
    const view = render(<ClanBattles clanId="home" canCreate={false} />);
    const buttons = view.getAllByRole("button", {
      name: "Join Home battle",
    }) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(buttons[0]!));
    expect(mutate).toHaveBeenCalledWith({ clanBattleId: "clan-battle" });
  });
}
it.each(["ASLEEP", "BATTLE", "TRAVEL", "QUEUED"])(
  "Territory War blocks unavailable %s actors",
  (status) => {
    actor.status = status;
    actor.autoWakeUp = false;
    const view = render(<TerritoryWarPage />);
    expect(
      (view.getByRole("button", { name: "Create guardian team" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (view.getByRole("button", { name: "Join team" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  },
);
it.each(["ASLEEP", "BATTLE", "TRAVEL", "QUEUED"])(
  "Clan battle blocks unavailable %s actors",
  (status) => {
    actor.status = status;
    actor.autoWakeUp = false;
    const view = render(<ClanBattles clanId="home" canCreate={false} />);
    expect(
      (
        view.getAllByRole("button", { name: "Join Home battle" }) as HTMLButtonElement[]
      ).every((button) => button.disabled),
    ).toBe(true);
  },
);
it("Territory War preserves wrong-sector restriction for an awake actor", () => {
  actor.sector = 101;
  const view = render(<TerritoryWarPage />);
  expect(
    (view.getByRole("button", { name: "Create guardian team" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Join team" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("Clan controls preserve participant membership restriction for an awake actor", () => {
  actor.clanId = "unrelated";
  const view = render(<ClanBattles clanId="home" canCreate={false} />);
  expect(
    (
      view.getAllByRole("button", { name: "Join Home battle" }) as HTMLButtonElement[]
    ).every((button) => button.disabled),
  ).toBe(true);
});
