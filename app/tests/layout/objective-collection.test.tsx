import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as countdown from "@/layout/Countdown";
import * as image from "@/layout/Image";
import * as link from "@/layout/Link";
import { Objective } from "@/layout/Objective";
import * as userContext from "@/utils/UserContext";
import { AllObjectives, QuestTracker } from "@/validators/objectives";

describe("collection objective countdown", () => {
  beforeEach(() => {
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({}),
      quests: {
        retryBattle: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    });
    vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
      data: { userId: "collector", role: "USER", status: "AWAKE" },
      timeDiff: 0,
    } as never);
    vi.spyOn(image, "default").mockImplementation(() => null);
    vi.spyOn(link, "default").mockImplementation(({ children }) => (
      <span>{children}</span>
    ));
    vi.spyOn(countdown, "default").mockImplementation(({ targetDate, onFinish }) => (
      <button type="button" onClick={onFinish}>
        {targetDate.toISOString()}
      </button>
    ));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    "uses the authoritative deadline with saved deadline=%s and requests server completion",
    (hasDeadline) => {
      const timestamp = "2026-10-01T00:00:00.000Z";
      const collectDeadline = "2026-10-01T00:00:50.000Z";
      const tracker = QuestTracker.parse({
        id: "quest",
        goals: [
          { id: "collect", timestamp, ...(hasDeadline ? { collectDeadline } : {}) },
        ],
      });
      const objective = AllObjectives.parse({
        id: "collect",
        task: "collect_item",
        sector: 1,
        longitude: 1,
        latitude: 1,
        collect_time_minutes: 1,
        collectItemIds: ["herb"],
        item_name: "Herb",
      });
      const checkRewards = vi.fn();
      const view = render(
        <Objective
          objective={objective}
          tracker={tracker}
          checkRewards={checkRewards}
        />,
      );
      fireEvent.click(
        view.getByRole("button", {
          name: hasDeadline ? collectDeadline : "2026-10-01T00:01:00.000Z",
        }),
      );
      expect(checkRewards).toHaveBeenCalledTimes(1);
    },
  );
});
