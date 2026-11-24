import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import { MAP_WAR_TORN_BATTLEGROUND_SECTOR } from "@/drizzle/constants";
import * as image from "@/layout/Image";
import * as link from "@/layout/Link";
import { Objective } from "@/layout/Objective";
import * as objectives from "@/libs/objectives";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { mockUserContextValue } from "../setup/userContext";

const FARM_TASKS = [
  "seeds_planted",
  "plants_watered",
  "plants_fertilized",
  "plants_harvested",
] as const;

describe("objective action guide", () => {
  beforeEach(() => {
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({}),
      quests: {
        retryBattle: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    });
    mockUserContextValue({
      data: { userId: "farmer", role: "USER", status: "AWAKE", autoWakeUp: true },
      timeDiff: 0,
    } as never);
    vi.spyOn(image, "default").mockImplementation(() => null);
    vi.spyOn(link, "default").mockImplementation(({ href, children }) => (
      <a href={String(href)}>{children}</a>
    ));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderObjective = (
    task: string,
    value: number,
    grayedOut = false,
    questType?: ComponentProps<typeof Objective>["questType"],
  ) =>
    render(
      <Objective
        objective={AllObjectives.parse({ id: "goal", task, value: 5 })}
        tracker={QuestTracker.parse({ id: "quest", goals: [{ id: "goal", value }] })}
        checkRewards={vi.fn()}
        grayedOut={grayedOut}
        questType={questType}
      />,
    );

  it.each(FARM_TASKS)("points %s to the farm, open to every profession", (task) => {
    const guide = objectives.getObjectiveActionGuide({ task });
    expect(guide?.href).toBe("/farm");
    expect(guide?.hint).toContain("Home");
    expect(guide?.hint).toContain("whatever your profession");

    const view = renderObjective(task, 0);
    const farmLink = view.getByRole("link", { name: /open your farm/i });
    expect(farmLink.getAttribute("href")).toBe("/farm");
    expect(view.getByText(/Go to Home and press Farm/)).toBeTruthy();
  });

  it("explains how to plant the Introduction to Farming seeds", () => {
    const view = renderObjective("seeds_planted", 2);
    expect(view.getByText(/tap an empty plot and plant a seed/)).toBeTruthy();
  });

  it("hides the pointer once the objective is done or not yet available", () => {
    expect(renderObjective("seeds_planted", 5).queryByRole("link")).toBeNull();
    cleanup();
    expect(renderObjective("seeds_planted", 0, true).queryByRole("link")).toBeNull();
  });

  it("adds no pointer to objectives the quest itself already locates", () => {
    expect(objectives.getObjectiveActionGuide({ task: "pvp_kills" })).toBeNull();
    expect(renderObjective("pvp_kills", 0).queryByRole("link")).toBeNull();
  });

  const mockTerritoryWar = (event: { sector: number; endsAt: Date } | null) =>
    Object.assign(client.api, {
      territoryWar: {
        getNotice: {
          useQuery: () => ({ data: { event, nextStartsAt: null }, dataUpdatedAt: 0 }),
        },
      },
    });

  it("tells PvP mission players where wins count while no Territory War runs", () => {
    mockTerritoryWar({ sector: 100, endsAt: new Date(Date.now() - 1000) });
    const view = renderObjective("pvp_kills", 0, false, "pvp");
    expect(view.container.textContent).toContain(
      `Wins only count in the War-Torn Battleground (sector ${MAP_WAR_TORN_BATTLEGROUND_SECTOR}) or against players in an active Territory War sector.`,
    );
    expect(view.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      `/travel?sector=${MAP_WAR_TORN_BATTLEGROUND_SECTOR}`,
      "/territory-war",
    ]);
  });

  it("links the sector of the running Territory War", () => {
    mockTerritoryWar({ sector: 100, endsAt: new Date(Date.now() + 60_000) });
    const view = renderObjective("pvp_kills", 0, false, "pvp");
    expect(view.container.textContent).toContain(
      "against players in the active Territory War (sector 100).",
    );
    expect(view.getByText("sector 100").getAttribute("href")).toBe(
      "/travel?sector=100",
    );
  });

  it("keeps the rule off other quest types, other tasks and finished objectives", () => {
    mockTerritoryWar(null);
    for (const [task, value, grayedOut, questType] of [
      ["pvp_kills", 0, false, "mission"],
      ["pvp_kills", 0, false, "war"],
      ["arena_kills", 0, false, "pvp"],
      ["pvp_kills", 5, false, "pvp"],
      ["pvp_kills", 0, true, "pvp"],
    ] as const) {
      const view = renderObjective(task, value, grayedOut, questType);
      expect(view.queryByText(/Wins only count/)).toBeNull();
      cleanup();
    }
  });

  it("offers a tower defense challenge only at the objective's position", () => {
    const renderChallenge = (position: {
      sector: number;
      longitude: number;
      latitude: number;
    }) => {
      mockUserContextValue({
        data: { userId: "defender", role: "USER", status: "AWAKE", ...position },
        timeDiff: 0,
      } as never);
      return render(
        <Objective
          objective={AllObjectives.parse({
            id: "goal",
            task: "win_tower_defense",
            sector: 5,
            longitude: 3,
            latitude: 4,
          })}
          tracker={QuestTracker.parse({
            id: "quest",
            goals: [{ id: "goal", value: 0 }],
          })}
          checkRewards={vi.fn()}
        />,
      );
    };
    const away = renderChallenge({ sector: 5, longitude: 2, latitude: 4 });
    expect(away.queryByRole("link", { name: /take position/i })).toBeNull();
    expect(away.getByText(/Travel to the position above to start/)).toBeTruthy();
    cleanup();
    const here = renderChallenge({ sector: 5, longitude: 3, latitude: 4 });
    expect(
      here.getByRole("link", { name: /take position/i }).getAttribute("href"),
    ).toBe("/towerDefense?quest=quest&objective=goal");
  });

  it("locates a storm challenge at the position rolled onto the tracker", () => {
    mockUserContextValue({
      data: {
        userId: "scout",
        role: "USER",
        status: "AWAKE",
        sector: 9,
        longitude: 6,
        latitude: 7,
      },
      timeDiff: 0,
    } as never);
    const view = render(
      <Objective
        objective={AllObjectives.parse({
          id: "goal",
          task: "win_chakra_storm",
          sector: 5,
          longitude: 3,
          latitude: 4,
        })}
        tracker={QuestTracker.parse({
          id: "quest",
          goals: [{ id: "goal", value: 0, sector: 9, longitude: 6, latitude: 7 }],
        })}
        checkRewards={vi.fn()}
      />,
    );
    expect(view.getByText("[6, 7]")).toBeTruthy();
    expect(
      view.getByRole("link", { name: /enter the storm/i }).getAttribute("href"),
    ).toBe("/chakraStorm?quest=quest&objective=goal");
  });

  it("seats a Kessen challenge at its position, naming the opponent and tier", () => {
    mockUserContextValue({
      data: {
        userId: "duelist",
        role: "USER",
        status: "AWAKE",
        sector: 5,
        longitude: 3,
        latitude: 4,
      },
      timeDiff: 0,
    } as never);
    const view = render(
      <Objective
        objective={AllObjectives.parse({
          id: "goal",
          task: "win_kessen_challenge",
          sector: 5,
          longitude: 3,
          latitude: 4,
          npcKey: "kimiko",
          tier: "JONIN",
        })}
        tracker={QuestTracker.parse({ id: "quest", goals: [] })}
        checkRewards={vi.fn()}
      />,
    );
    expect(view.getByText(/against Kimiko, played at Jonin difficulty/)).toBeTruthy();
    expect(view.getByRole("link", { name: /take a seat/i }).getAttribute("href")).toBe(
      "/kessen?quest=quest&objective=goal",
    );
  });
});
