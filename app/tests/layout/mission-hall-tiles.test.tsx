import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import * as QuestStartCache from "@/hooks/useQuestStartCacheUpdate";
import * as Image from "@/layout/Image";
import MissionHall from "@/layout/MissionHall";
import * as MissionPicker from "@/layout/MissionPicker";
import * as UserContext from "@/utils/UserContext";

type HallUser = ComponentProps<typeof MissionHall>["userData"];

const hallQuest = (
  id: string,
  questType: string,
  questRank: string,
  requiredVillage: string | null = null,
) => ({
  id,
  name: id,
  image: "",
  questType,
  questRank,
  requiredVillage,
  medicalRank: null,
  hidden: false,
  maxAttempts: 1,
  maxCompletes: 1,
  retryDelay: "none",
  content: { objectives: [], reward: {} },
});

const hallData = [
  hallQuest("d-mission", "mission", "D"),
  hallQuest("d-errand", "errand", "D"),
  hallQuest("d-medical", "medical", "D"),
  hallQuest("c-crime", "crime", "C"),
  hallQuest("c-medical", "medical", "C"),
  hallQuest("a-mission", "mission", "A"),
  hallQuest("a-crime", "crime", "A"),
  hallQuest("a-crime-village", "crime", "A", "konoha"),
  hallQuest("a-mission-syndicate", "mission", "A", "syndicate"),
  hallQuest("a-errand", "errand", "A"),
  hallQuest("a-medical", "medical", "A"),
  hallQuest("a-pvp", "pvp", "A"),
];

const user = (overrides: Partial<HallUser> = {}) =>
  ({
    userId: "player",
    sector: 0,
    rank: "JONIN",
    status: "AWAKE",
    level: 50,
    isOutlaw: false,
    villageId: "konoha",
    userQuests: [],
    questData: [],
    medicalExperience: 0,
    dailyMissions: 0,
    dailyErrands: 0,
    dailyMedicalMissions: 0,
    dailyPvpMissions: 0,
    ...overrides,
  }) as unknown as HallUser;

let pickers: Record<
  string,
  { ids: string[]; count: number; disabled: boolean | undefined }
>;

beforeEach(() => {
  pickers = {};
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(MissionPicker, "default").mockImplementation(
    ({ setting, missions, disabled }) => {
      // The picker shows how many missions it was given.
      pickers[setting.name] = {
        ids: missions.map((m) => m.id),
        count: missions.length,
        disabled,
      };
      return null;
    },
  );
  vi.spyOn(QuestStartCache, "useQuestStartCacheUpdate").mockReturnValue({
    prepareQuestStartUpdate: () => ({}),
    updateQuestStart: vi.fn(),
  } as never);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    prepareUserUpdate: () => 1,
    updateUser: vi.fn(),
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    quests: {
      missionHall: { useQuery: () => ({ data: hallData }) },
      startRandom: { useMutation: () => ({ isPending: false }) },
      startQuest: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Mission Hall tiles", () => {
  it("counts only the tile's quest type on random tiles", () => {
    const view = render(<MissionHall userData={user()} />);
    const tile = (name: string) => view.getByText(name).closest("button");
    expect(tile("Errand")?.textContent).toContain("[Random out of 1 available]");
    expect(tile("D-rank")?.textContent).toContain("[Random out of 1 available]");
    // A C-rank crime is not a mission, so a village player's tile has nothing to draw.
    expect(tile("C-rank")?.textContent).toContain("[Random out of 0 available]");
    expect(tile("C-rank")?.hasAttribute("disabled")).toBe(true);
  });

  it("keeps the A-rank picker on type plus village-locked quests of the other classifier", () => {
    render(<MissionHall userData={user()} />);
    expect(pickers["A-rank"]?.ids.sort()).toEqual(
      ["a-crime-village", "a-mission", "a-mission-syndicate"].sort(),
    );
    expect(pickers["A-rank"]?.count).toBe(3);
  });

  it("leaves unstartable A-rank errands off every picker", () => {
    render(<MissionHall userData={user()} />);
    expect(Object.values(pickers).flatMap((picker) => picker.ids)).not.toContain(
      "a-errand",
    );
  });

  it("uses crime as the type for outlaws", () => {
    render(<MissionHall userData={user({ isOutlaw: true })} />);
    expect(pickers["A-rank"]?.ids.sort()).toEqual(
      ["a-crime", "a-crime-village", "a-mission-syndicate"].sort(),
    );
  });

  it("gives medical and PvP quests moved off the A-rank picker a home on their own tiles", () => {
    render(<MissionHall userData={user()} />);
    expect(pickers.Medical?.ids.sort()).toEqual([
      "a-medical",
      "c-medical",
      "d-medical",
    ]);
    expect(pickers.Medical?.count).toBe(3);
    expect(pickers.PvP?.ids).toEqual(["a-pvp"]);
  });

  it("limits medical tiles to the letter ranks a player can take", () => {
    render(<MissionHall userData={user({ rank: "GENIN" })} />);
    expect(pickers.Medical?.ids.sort()).toEqual(["c-medical", "d-medical"]);
  });
});
