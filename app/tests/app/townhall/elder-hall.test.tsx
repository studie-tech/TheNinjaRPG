import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import TownHall from "@/app/[shell]/townhall/page";
import { KAGE_ELDER_REMOVAL_LOCK_SECS } from "@/drizzle/constants";
import * as localstorage from "@/hooks/localstorage";
import * as ContentBox from "@/layout/ContentBox";
import * as search from "@/utils/search";
import * as UserContext from "@/utils/UserContext";

const DAY_MS = 24 * 3600 * 1000;
const idle = {
  useQuery: () => ({ data: undefined, isPending: false, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
};
/** Router whose procedures are idle unless a test overrides them. */
const router = (overrides: object = {}) =>
  new Proxy(overrides, {
    get: (target, name) => (target as Record<string | symbol, unknown>)[name] ?? idle,
  });

beforeEach(() => {
  vi.spyOn(localstorage, "useLocalStorage").mockReturnValue([
    "Elders",
    vi.fn(),
  ] as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(search, "useUserPicker").mockReturnValue({
    methods: {},
    user: undefined,
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("counts the kage's protected tenure on the server clock", () => {
  // The client clock runs two days behind the server; one server day of tenure remains.
  const timeDiff = -2 * DAY_MS;
  const serverNow = Date.now() - timeDiff;
  const leaderUpdatedAt = new Date(
    serverNow - KAGE_ELDER_REMOVAL_LOCK_SECS * 1000 + DAY_MS,
  );
  const elder = {
    userId: "elder",
    villageId: "village",
    rank: "ELDER",
    isBanned: false,
    isOutlaw: false,
  };
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: elder,
    timeDiff,
    updateUser: vi.fn(),
    prepareUserUpdate: vi.fn(),
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => router(),
    kage: router({
      getElders: { useQuery: () => ({ data: [elder], isPending: false }) },
    }),
    clan: router({ getAll: { useQuery: () => ({ data: [], isPending: false }) } }),
    village: router({
      get: {
        useQuery: () => ({
          data: { villageData: { kageId: "kage", leaderUpdatedAt } },
        }),
      },
    }),
    war: router({
      getElderVotes: { useQuery: () => ({ data: [], refetch: vi.fn() }) },
    }),
  });
  const view = render(<TownHall />);
  expect(view.getByText(/The kage is protected for/).textContent).toContain(
    "protected for 1 more day(s)",
  );
});
