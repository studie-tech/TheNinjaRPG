import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import * as combatHooks from "@/hooks/combat";
import * as navigation from "@/hooks/navigation";
import { SparringMode } from "@/layout/battlearena/SparringMode";
import * as image from "@/layout/Image";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import * as userContext from "@/utils/UserContext";

const browserGlobals = ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

let finderInputs: Record<string, unknown>[];
const mutations: Record<string, ReturnType<typeof vi.fn>> = {};
const player = (userId: string, username: string, level: number) => ({
  userId,
  username,
  level,
  rank: "GENIN",
  avatar: null,
  updatedAt: new Date(),
  village: { name: "Akikaze" },
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
    sender: { username: "Kaito", level: 31, rank: "GENIN", village: { name: "Hyorin" } },
    receiver: { username: "Me", level: 30, rank: "GENIN", village: { name: "Akikaze" } },
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
    receiver: { username: "Rin", level: 29, rank: "GENIN", village: { name: "Akikaze" } },
  },
];

beforeEach(() => {
  for (const key of browserGlobals) {
    if (key in window) Object.defineProperty(globalThis, key, { configurable: true, value: window[key as keyof Window] });
  }
  finderInputs = [];
  for (const name of ["createChallenge", "acceptChallenge", "rejectChallenge", "cancelChallenge"]) {
    mutations[name] = vi.fn();
  }
  const useMutation = (name: string) => () => ({ mutate: mutations[name], isPending: false });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      sparring: { getUserChallenges: { invalidate: vi.fn() } },
      pvpRank: { getRankedLoadout: { invalidate: vi.fn() } },
    }),
    profile: {
      getPublicUsers: {
        useInfiniteQuery: (input: Record<string, unknown>) => {
          finderInputs.push(input);
          return {
            data: {
              pages: [
                {
                  data: [player("me", "Me", 30), player("sora", "Sora", 30), player("rin", "Rin", 29)],
                  nextCursor: 1,
                },
              ],
            },
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
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(jutsuLoadout, "default").mockImplementation((() => <p>Jutsu loadout</p>) as never);
  vi.spyOn(itemLoadout, "default").mockImplementation((() => <p>Item loadout</p>) as never);
  // biome-ignore lint/performance/noImgElement: isolated avatar fixture
  vi.spyOn(image, "default").mockImplementation((({ alt }: { alt: string }) => <img alt={alt} />) as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
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
  fireEvent.change(screen.getByLabelText("Search any ninja by name"), { target: { value: "kai" } });
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
  expect(lastInput()).toEqual({ limit: 20, orderBy: "Online", isAi: false, username: "kai" });
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
