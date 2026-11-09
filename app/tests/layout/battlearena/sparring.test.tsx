import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ZodType } from "zod";
import * as client from "@/app/_trpc/client";
import type { UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import * as combatHooks from "@/hooks/combat";
import * as navigation from "@/hooks/navigation";
import * as loadoutNames from "@/hooks/useLoadoutNames";
import { SparringMode } from "@/layout/battlearena/SparringMode";
import * as image from "@/layout/Image";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import { sparringRouter } from "@/server/api/routers/sparring";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type { UserDeltaResponse } from "@/validators/userCache";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

let finderInputs: Record<string, unknown>[];
let finderOptions: Record<string, unknown>[];
let finderUpdatedAt: number;
let playerUpdatedAt: Date;
let playerAvatar: string | null;
const mutations: Record<string, ReturnType<typeof vi.fn>> = {};
const player = (userId: string, username: string, level: number) => ({
  userId,
  username,
  level,
  rank: "GENIN",
  avatar: playerAvatar,
  updatedAt: playerUpdatedAt,
  village: { name: "Akikaze" },
  experience: 15_000,
  pvpExperience: 420,
});

const challenges = [
  {
    id: "c-in",
    senderId: "kaito",
    receiverId: "me",
    status: "PENDING",
    type: "SPAR",
    useRankedRules: true,
    spectatable: true,
    createdAt: new Date(),
    sender: {
      username: "Kaito",
      level: 31,
      rank: "GENIN",
      village: { name: "Hyorin" },
    },
    receiver: {
      username: "Me",
      level: 30,
      rank: "GENIN",
      village: { name: "Akikaze" },
    },
  },
  {
    id: "c-out",
    senderId: "me",
    receiverId: "rin",
    status: "PENDING",
    type: "SPAR",
    useRankedRules: false,
    spectatable: false,
    createdAt: new Date(),
    sender: { username: "Me", level: 30, rank: "GENIN", village: { name: "Akikaze" } },
    receiver: {
      username: "Rin",
      level: 29,
      rank: "GENIN",
      village: { name: "Akikaze" },
    },
  },
];

beforeEach(() => {
  installBrowserGlobals();
  finderInputs = [];
  finderOptions = [];
  finderUpdatedAt = Date.now();
  playerUpdatedAt = new Date(finderUpdatedAt);
  playerAvatar = null;
  for (const name of [
    "createChallenge",
    "acceptChallenge",
    "rejectChallenge",
    "cancelChallenge",
  ]) {
    mutations[name] = vi.fn();
  }
  const useMutation = (name: string) => () => ({
    mutate: mutations[name],
    isPending: false,
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      sparring: { getUserChallenges: { invalidate: vi.fn() } },
      pvpRank: { getRankedLoadout: { invalidate: vi.fn() } },
    }),
    profile: {
      getPublicUsers: {
        useInfiniteQuery: (
          input: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          finderInputs.push(input);
          finderOptions.push(options);
          return {
            data: {
              pages: [
                {
                  data: [
                    player("me", "Me", 30),
                    player("sora", "Sora", 30),
                    player("rin", "Rin", 29),
                  ],
                  nextCursor: 1,
                },
              ],
            },
            dataUpdatedAt: finderUpdatedAt,
            fetchNextPage: vi.fn(),
            hasNextPage: true,
            isFetching: false,
          };
        },
      },
    },
    sparring: {
      getUserChallenges: { useQuery: () => ({ data: challenges }) },
      createChallenge: { useMutation: useMutation("createChallenge") },
      acceptChallenge: { useMutation: useMutation("acceptChallenge") },
      rejectChallenge: { useMutation: useMutation("rejectChallenge") },
      cancelChallenge: { useMutation: useMutation("cancelChallenge") },
    },
  });
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "me", level: 30, villageId: "v-1", userQuests: [], questData: [] },
    updateUser: vi.fn(),
  } as never);
  vi.spyOn(combatHooks, "useAutoCombatSetting").mockReturnValue([false, vi.fn()]);
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({
    jutsu: null,
    item: null,
  });
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({
    push: vi.fn(),
  } as never);
  vi.spyOn(jutsuLoadout, "default").mockImplementation((() => (
    <p>Jutsu loadout</p>
  )) as never);
  vi.spyOn(itemLoadout, "default").mockImplementation((() => (
    <p>Item loadout</p>
  )) as never);
  vi.spyOn(image, "default").mockImplementation(({ alt, src, onError }) => (
    // biome-ignore lint/performance/noImgElement: isolated avatar fixture
    <img alt={alt} src={typeof src === "string" ? src : undefined} onError={onError} />
  ));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const lastInput = () => finderInputs.at(-1) ?? {};
const finder = () => screen.getByRole("list", { name: "Opponents" });

it("searches near my level and online by default", () => {
  render(<SparringMode />);
  expect(lastInput()).toEqual({
    limit: 20,
    orderBy: "Online",
    isAi: false,
    minLevel: 25,
    maxLevel: 35,
    activeWithinMinutes: 30,
  });
  expect(within(finder()).queryByText("Me")).toBeNull();
});

it("combines and drops filters", () => {
  render(<SparringMode />);
  fireEvent.click(screen.getByRole("button", { name: "Online now" }));
  expect(lastInput().activeWithinMinutes).toBeUndefined();
  expect(lastInput().minLevel).toBe(25);
  fireEvent.click(screen.getByRole("button", { name: "My village" }));
  expect(lastInput().village).toBe("v-1");
});

it("searches any ninja by name", async () => {
  render(<SparringMode />);
  fireEvent.change(screen.getByLabelText("Search any ninja by name"), {
    target: { value: "kai" },
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
  expect(lastInput()).toEqual({
    limit: 20,
    orderBy: "Online",
    isAi: false,
    username: "kai",
  });
});

it("challenges with the chosen options", () => {
  render(<SparringMode />);
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Ranked rules/ })[0]!);
  fireEvent.click(within(finder()).getByRole("button", { name: "Challenge Sora" }));
  expect(mutations.createChallenge).toHaveBeenCalledWith({
    targetId: "sora",
    useRankedRules: true,
    spectatable: false,
  });
});

it("marks players already challenged", () => {
  render(<SparringMode />);
  const rin = within(finder()).getByRole("button", { name: "Challenged Rin" });
  expect(rin.hasAttribute("disabled")).toBe(true);
});

it("accepts, declines and cancels challenges", () => {
  render(<SparringMode />);
  const list = screen.getByRole("list", { name: "Challenges" });
  expect(within(list).getByText(/Ranked rules · spectators allowed/)).toBeDefined();
  fireEvent.click(within(list).getByRole("button", { name: "Accept" }));
  fireEvent.click(within(list).getByRole("button", { name: "Decline" }));
  fireEvent.click(within(list).getByRole("button", { name: "Cancel" }));
  expect(mutations.acceptChallenge).toHaveBeenCalledWith({ id: "c-in" });
  expect(mutations.rejectChallenge).toHaveBeenCalledWith({ id: "c-in" });
  expect(mutations.cancelChallenge).toHaveBeenCalledWith({ id: "c-out" });
});

it("refreshes activity results and labels from the query timestamp", () => {
  const view = render(<SparringMode />);
  expect(screen.getAllByText(/online$/).length).toBeGreaterThan(0);
  expect(finderOptions.at(-1)).toMatchObject({
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  finderUpdatedAt += 31 * 60_000;
  view.rerender(<SparringMode />);
  expect(screen.queryByText(/online$/)).toBeNull();
});

it("shows a player's card with their progress and profile from the list", async () => {
  render(<SparringMode />);
  const kaitoRow = within(finder()).getAllByRole("listitem")[0]!;
  fireEvent.click(within(kaitoRow).getByRole("button", { name: /^About / }));
  const card = await screen.findByRole("dialog");
  expect(
    within(card).getByRole("img", { name: "Sora avatar unavailable" }),
  ).toBeDefined();
  expect(within(card).getByText("Experience")).toBeDefined();
  expect(within(card).getByText("15,000")).toBeDefined();
  expect(within(card).getByText("PvP experience")).toBeDefined();
  expect(within(card).getByText("420")).toBeDefined();
  const profile = within(card).getByRole("link", { name: "See profile" });
  expect(profile.getAttribute("href")).toMatch(/^\/username\//);
});

it("replaces a failed player portrait with the avatar fallback", async () => {
  playerAvatar = "https://example.com/portrait.webp";
  render(<SparringMode />);
  fireEvent.click(screen.getByRole("button", { name: "About Sora" }));
  const card = await screen.findByRole("dialog");
  fireEvent.error(within(card).getByRole("img", { name: "Sora" }));
  expect(within(card).queryByRole("img", { name: "Sora" })).toBeNull();
  expect(
    within(card).getByRole("img", { name: "Sora avatar unavailable" }),
  ).toBeDefined();
});

it.each(["AWAKE", "ASLEEP", "HOSPITALIZED"] as const)(
  "retains the actual unrated spar output projection for %s without fetching the profile",
  async (status) => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [["profile", "getUser"], { type: "query" }];
    const initial = {
      userData: {
        userId: "me",
        status,
        battleId: null,
        level: 30,
        villageId: "v-1",
        userQuests: [],
        questData: [],
        curHealth: 5,
        curChakra: 6,
        curStamina: 7,
      },
      notifications: [],
    };
    cache.setQueryData(key, initial);
    const read = vi.fn(async () => initial);
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: read,
    });
    const unsubscribe = observer.subscribe(() => {});
    const output = (
      sparringRouter.acceptChallenge._def as unknown as {
        output: ZodType<UserDeltaResponse & { battleId?: string }>;
      }
    ).output;
    const response = output.parse({
      success: true,
      message: "Battle started",
      battleId: "spar",
      userPatch: { status: "BATTLE", battleId: "spar" },
      userDelta: {},
      ...(status !== "AWAKE"
        ? {
            actionNotice: "Recovered",
            userRecovery: {
              userId: "me",
              userPatch: {
                status: "AWAKE",
                curHealth: 100,
                curChakra: 90,
                curStamina: 80,
              },
            },
          }
        : {}),
    });
    let callbacks!: {
      onMutate: () => number | undefined;
      onSuccess: (
        result: typeof response,
        input: unknown,
        revision: number | undefined,
      ) => Promise<void>;
    };
    Object.assign(client.api.sparring.acceptChallenge, {
      useMutation: (options: typeof callbacks) => {
        callbacks = options;
        return {
          mutate: async () =>
            callbacks.onSuccess(response, { id: "c-in" }, callbacks.onMutate()),
          isPending: false,
        };
      },
    });
    Object.assign(client.api.sparring.getUserChallenges, {
      useQuery: () => ({
        data: challenges.map((challenge) => ({ ...challenge, useRankedRules: false })),
      }),
    });
    vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
      data: initial.userData,
      prepareUserUpdate: () => prepareUserUpdate(cache, key),
      updateUser: (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
        updateUserCache(cache, key, patch, options),
    } as never);
    try {
      const view = render(<SparringMode />);
      await act(async () =>
        fireEvent.click(
          within(view.getByRole("list", { name: "Challenges" })).getByRole("button", {
            name: "Accept",
          }),
        ),
      );
      expect(read).not.toHaveBeenCalled();
      expect(cache.getQueryData(key)).toMatchObject({
        userData: {
          status: "BATTLE",
          battleId: "spar",
          curHealth: status === "AWAKE" ? 5 : 100,
          curChakra: status === "AWAKE" ? 6 : 90,
          curStamina: status === "AWAKE" ? 7 : 80,
        },
      });
    } finally {
      unsubscribe();
      cache.clear();
    }
  },
);
