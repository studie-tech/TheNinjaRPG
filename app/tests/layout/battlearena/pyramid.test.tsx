import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import * as questStart from "@/hooks/useQuestStartCacheUpdate";
import { climbLabelFontSize, PyramidMode } from "@/layout/battlearena/PyramidMode";
import * as image from "@/layout/Image";
import * as logbook from "@/layout/Logbook";
import * as questTeams from "@/layout/QuestTeams";
import * as userContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

let startQuest: ReturnType<typeof vi.fn>;
let mutationOptions: NonNullable<
  Parameters<typeof client.api.quests.startQuest.useMutation>[0]
>;
let prepareUserUpdate: ReturnType<typeof vi.fn>;
let updateUser: ReturnType<typeof vi.fn>;
let prepareQuestStartUpdate: ReturnType<typeof vi.fn>;
let updateQuestStart: ReturnType<typeof vi.fn>;
let towers: Record<string, unknown>[];
let userQuests: Record<string, unknown>[];
let questData: Record<string, unknown>[];

const tower = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  image: null,
  description: `${name} description`,
  questType: "battlepyramid",
  requiredLevel: 1,
  maxLevel: 100,
  teamEnabled: false,
  entryRequirements: [],
  content: { objectives: [], reward: {}, isolated: false },
  ...extra,
});

beforeEach(() => {
  installBrowserGlobals();
  startQuest = vi.fn();
  prepareUserUpdate = vi.fn(() => 7);
  updateUser = vi.fn(async () => true);
  prepareQuestStartUpdate = vi.fn(() => ({ inventory: 3 }));
  updateQuestStart = vi.fn();
  towers = [
    tower("t-open", "Test Arena", {
      content: { objectives: [], reward: { reward_money: 2000 }, isolated: false },
    }),
    tower("t-items", "Tower of Echoes", {
      entryRequirements: [{ itemId: "shard", name: "shard", quantity: 2, owned: 1 }],
    }),
  ];
  userQuests = [];
  questData = [];
  Object.assign(vi.spyOn(client, "api" as never), {
    quests: {
      specificQuests: { useQuery: () => ({ data: towers }) },
      upcomingQuests: {
        useQuery: () => ({
          data: [
            {
              id: "t-locked",
              name: "Golden Steps",
              image: null,
              description: null,
              requiredLevel: 50,
              maxLevel: 110,
              block: { kind: "level", required: 50, current: 30 },
            },
            {
              id: "t-mastery",
              name: "Hall of Mirrors",
              image: null,
              description: null,
              requiredLevel: 1,
              maxLevel: 110,
              block: {
                kind: "mastery",
                label: "Ninjutsu Mastery",
                required: 500,
                current: 100,
              },
            },
          ],
        }),
      },
      startQuest: {
        useMutation: (options: typeof mutationOptions) => {
          mutationOptions = options;
          return { mutate: startQuest, isPending: false };
        },
      },
    },
    item: {
      getAllNames: {
        useQuery: () => ({ data: [{ id: "shard", name: "Echo Shard" }] }),
      },
    },
  });
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: {
          userId: "me",
          level: 30,
          sector: 4,
          userQuests,
          questData,
          petTask: null,
        },
        prepareUserUpdate,
        updateUser,
      }) as never,
  );
  vi.spyOn(questStart, "useQuestStartCacheUpdate").mockReturnValue({
    prepareQuestStartUpdate,
    updateQuestStart,
  } as never);
  vi.spyOn(logbook, "LogbookEntry").mockImplementation(() => <p>Current objective</p>);
  vi.spyOn(questTeams, "QuestTeams").mockImplementation(() => null);
  // biome-ignore lint/performance/noImgElement: isolated art fixture
  vi.spyOn(image, "default").mockImplementation((({ alt }: { alt: string }) => (
    <img alt={alt} />
  )) as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const card = (name: string) => screen.getByRole("article", { name });
// Confirm wraps its trigger, so the tower's own button is found by its id.
const climbButton = (id: string) =>
  document.getElementById(`tutorial-take-quest-${id}`)!;

it("renders the logbook entry of a climb without a saved tracker", () => {
  userQuests = [
    {
      questId: "t-capped",
      endAt: null,
      startedAt: new Date("2026-01-01"),
      quest: { id: "t-capped", name: "Skychain Monastery", questType: "battlepyramid" },
    },
  ];
  render(<PyramidMode />);
  const climb = card("Skychain Monastery");
  expect(within(climb).getByText("Climbing now")).toBeDefined();
  expect(within(climb).getByText("Current objective")).toBeDefined();
  const entry = logbook.LogbookEntry as unknown as ReturnType<typeof vi.fn>;
  expect(entry.mock.calls[0]?.[0].tracker).toMatchObject({ id: "t-capped", goals: [] });
});

it("lists the tower being climbed first", () => {
  userQuests = [
    {
      questId: "t-items",
      endAt: null,
      quest: { id: "t-items", name: "Tower of Echoes", questType: "battlepyramid" },
    },
  ];
  questData = [{ id: "t-items", goals: [] }];
  render(<PyramidMode />);
  const names = within(screen.getByRole("list", { name: "Towers" }))
    .getAllByRole("article")
    .map((article) => article.getAttribute("aria-label"));
  expect(names).toEqual(["Tower of Echoes", "Test Arena"]);
  expect(within(card("Tower of Echoes")).getByText("Climbing now")).toBeDefined();
  expect(within(card("Tower of Echoes")).getByText("Current objective")).toBeDefined();
  const other = within(card("Test Arena")).getByRole("button", {
    name: /Finish current climb/,
  });
  expect(other.hasAttribute("disabled")).toBe(true);
  // The button keeps its size: a long label shrinks onto one line and never spills out.
  expect(other.className).toMatch(/(^|\s)h-11(\s|$)/);
  expect(other.className).not.toContain("whitespace-normal");
  expect(other.getAttribute("title")).toBe("Finish Tower of Echoes first");
  expect(other.querySelector("span")?.className).toContain("truncate");
});

it("shrinks only labels too long for the button", () => {
  expect(climbLabelFontSize("Climb tower")).toBe(
    "clamp(0.625rem, calc((100cqi - 1.75rem) / 6.05), 0.875rem)",
  );
  // At the default 12px root size this 20-character label fits the 132px desktop button near 7.9px.
  expect(climbLabelFontSize("Finish current climb")).toBe(
    "clamp(0.625rem, calc((100cqi - 1.75rem) / 11), 0.875rem)",
  );
});

it("lists towers open to the player before towers missing entry items", () => {
  towers = [...towers].reverse();
  render(<PyramidMode />);
  const names = within(screen.getByRole("list", { name: "Towers" }))
    .getAllByRole("article")
    .map((article) => article.getAttribute("aria-label"));
  expect(names).toEqual(["Test Arena", "Tower of Echoes"]);
});

it("shows entry items and blocks the climb when short", () => {
  render(<PyramidMode />);
  const echoes = card("Tower of Echoes");
  expect(
    within(echoes)
      .getByText(/Uses 2× Echo Shard/)
      .closest("p")?.textContent,
  ).toContain("you have 1");
  const button = within(echoes).getByRole("button", { name: "Missing 1 item" });
  expect(button.hasAttribute("disabled")).toBe(true);
});

it("allows the climb when stacks cover the cost", () => {
  towers = [
    tower("t-items", "Tower of Echoes", {
      entryRequirements: [{ itemId: "shard", name: "shard", quantity: 2, owned: 2 }],
    }),
  ];
  render(<PyramidMode />);
  const button = climbButton("t-items");
  expect(button.textContent).toContain("Climb tower");
  expect(button.hasAttribute("disabled")).toBe(false);
});

it("confirms before spending entry items", () => {
  towers = [
    tower("t-items", "Tower of Echoes", {
      entryRequirements: [{ itemId: "shard", name: "shard", quantity: 2, owned: 3 }],
    }),
  ];
  render(<PyramidMode />);
  act(() => {
    fireEvent.click(climbButton("t-items"));
  });
  expect(startQuest).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").textContent).toContain("2× Echo Shard");
});

it("starts an open tower without entry costs directly", () => {
  render(<PyramidMode />);
  fireEvent.click(
    within(card("Test Arena")).getByRole("button", { name: "Climb tower" }),
  );
  expect(startQuest).toHaveBeenCalledWith({
    questId: "t-open",
    userSector: 4,
    supportsAnnouncements: true,
  });
});

it("lists coming-up towers with what they need", () => {
  render(<PyramidMode />);
  const upcoming = screen.getByRole("list", { name: "Coming up" });
  expect(within(upcoming).getByText("Needs level 50 · you are 30")).toBeDefined();
  expect(
    within(upcoming).getByText("Needs 500 Ninjutsu Mastery · you have 100"),
  ).toBeDefined();
  expect(within(upcoming).queryByRole("button", { name: /Climb/ })).toBeNull();
});

it("shows rewards or says none are listed", () => {
  render(<PyramidMode />);
  expect(within(card("Test Arena")).getByText("2000 ryo")).toBeDefined();
  expect(within(card("Tower of Echoes")).getByText("No reward listed")).toBeDefined();
});

it("reconciles tower starts with the profile and inventory revisions captured before mutation", async () => {
  render(<PyramidMode />);
  const input = { questId: "t-open", userSector: 4, supportsAnnouncements: true };
  const response = { success: true, message: "Started", userPatch: { money: 900 } };
  const context = await mutationOptions.onMutate?.(input, {} as never);
  await mutationOptions.onSuccess?.(response as never, input, context, {} as never);
  expect(prepareUserUpdate).toHaveBeenCalledTimes(1);
  expect(prepareQuestStartUpdate).toHaveBeenCalledTimes(1);
  expect(updateUser).toHaveBeenCalledWith(response, { revision: 7 });
  expect(updateQuestStart).toHaveBeenCalledWith(response, { inventory: 3 }, true);
});
