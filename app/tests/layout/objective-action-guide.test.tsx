import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
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

  const renderObjective = (task: string, value: number, grayedOut = false) =>
    render(
      <Objective
        objective={AllObjectives.parse({ id: "goal", task, value: 5 })}
        tracker={QuestTracker.parse({ id: "quest", goals: [{ id: "goal", value }] })}
        checkRewards={vi.fn()}
        grayedOut={grayedOut}
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

  it("opens a tower defense challenge only from the objective's position", () => {
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
    expect(away.queryByRole("link", { name: /open challenge/i })).toBeNull();
    expect(away.getByText(/Travel to the position above to start/)).toBeTruthy();
    cleanup();
    const here = renderChallenge({ sector: 5, longitude: 3, latitude: 4 });
    expect(
      here.getByRole("link", { name: /open challenge/i }).getAttribute("href"),
    ).toBe("/towerDefense?quest=quest&objective=goal");
  });
});
