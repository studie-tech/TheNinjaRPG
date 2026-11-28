import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as notices from "@/hooks/useEventTournamentNotices";
import * as ContentBox from "@/layout/ContentBox";
import { EventTournaments, resolveTournamentView } from "@/layout/EventTournaments";
import { createEventState } from "@/libs/tournament/events";
import * as routing from "@/utils/routing";
import { eventTournamentConfigSchema } from "@/validators/tournament";
import { testRouter } from "../setup/router";
import { mockUserContextValue } from "../setup/userContext";

const router = testRouter("tournament-staff-route");

/** An open registration event, as a player would see it from a shared link. */
const event = () => {
  const state = createEventState(
    eventTournamentConfigSchema.parse({
      name: "Winter Cup",
      description: "Tournament",
      registration: "OPEN",
      format: "SINGLE_ELIMINATION",
      seeding: "RANDOM",
      rules: "OPEN",
      scheduling: "SIMULTANEOUS",
      capacity: 8,
      bestOf: 1,
      roundBestOf: [],
      minBracket: 0,
      maxBracket: 7,
      minPvpWins: 0,
      minWinRate: 0,
      minMasteredJutsu: 0,
      registrationClosesAt: Date.now() + 3600_000,
      endsAt: Date.now() + 7200_000,
      rewards: {
        winner: {},
        runnerUp: {},
        semifinalist: {},
        participation: {},
        perWin: {},
      },
    }),
  );
  state.status = "REGISTRATION";
  return state;
};

const mockApi = () => {
  const query =
    (data: unknown) => (_input?: unknown, options?: { enabled?: boolean }) => ({
      data: options?.enabled === false ? undefined : data,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  const invalidate = { invalidate: vi.fn() };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      tournament: { getEvent: invalidate, listEvents: invalidate },
      profile: { getUser: invalidate },
    }),
    profile: { searchUsers: { useQuery: query([]) } },
    tournament: {
      listEvents: {
        useQuery: query([
          { id: "cup", eventData: { ...event(), participantCount: 0 } },
        ]),
      },
      getEvent: { useQuery: query({ eventData: event(), eligibility: [] }) },
      manageEvent: { useMutation: mutation },
      participateEvent: { useMutation: mutation },
    },
  });
};

const signIn = (role: string) =>
  mockUserContextValue({
    isSignedIn: true,
    status: "success",
    timeDiff: 0,
    data: { userId: "player", role } as never,
  });

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue(router);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/manual/tournaments/cup");
  vi.spyOn(notices, "useEventTournamentNoticeCache").mockReturnValue({
    refreshEventTournamentNotices: vi.fn(async () => undefined),
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ title, children }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ));
  mockApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = (props: { tournamentId?: string; staff?: boolean }) =>
  render(
    <AppRouterContext.Provider value={router}>
      <EventTournaments {...props} />
    </AppRouterContext.Provider>,
  );

describe("resolveTournamentView", () => {
  it("keeps the staff variant for tournament managers only", () => {
    expect(resolveTournamentView(true, true)).toEqual({
      staffView: true,
      basePath: "/manual/tournaments",
    });
    expect(resolveTournamentView(true, false)).toEqual({
      staffView: false,
      basePath: "/tournaments",
    });
    expect(resolveTournamentView(false, true)).toEqual({
      staffView: false,
      basePath: "/tournaments",
    });
  });
});

describe("staff tournament route opened by a player", () => {
  it("shows the event with sign-up instead of a staff access wall", () => {
    signIn("USER");
    mount({ tournamentId: "cup", staff: true });
    expect(screen.queryByText(/staff access is required/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Join tournament" })).toBeTruthy();
    expect(screen.queryByText(/Staff view/)).toBeNull();
  });

  it("lists events with links to the player pages", () => {
    signIn("USER");
    mount({ staff: true });
    expect(screen.queryByText(/staff access is required/i)).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Wake Island Tournaments" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /Winter Cup/ });
    expect(link.getAttribute("href")).toBe("/tournaments/cup");
  });
});

describe("staff tournament route opened by a manager", () => {
  it("keeps manual links and points at the player page to share", () => {
    signIn("CONTENT");
    mount({ staff: true });
    expect(screen.getByRole("heading", { name: "Manage tournaments" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Winter Cup/ }).getAttribute("href")).toBe(
      "/manual/tournaments/cup",
    );
    expect(screen.getByRole("link", { name: "player page" }).getAttribute("href")).toBe(
      "/tournaments",
    );
  });

  it("links the event's player page from the staff detail view", () => {
    signIn("CONTENT");
    mount({ tournamentId: "cup", staff: true });
    expect(screen.getByRole("link", { name: "player page" }).getAttribute("href")).toBe(
      "/tournaments/cup",
    );
  });
});
