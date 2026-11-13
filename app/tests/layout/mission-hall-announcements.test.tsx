import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import * as QuestStartCache from "@/hooks/useQuestStartCacheUpdate";
import * as Image from "@/layout/Image";
import MissionHall from "@/layout/MissionHall";
import * as MissionPicker from "@/layout/MissionPicker";
import * as toast from "@/libs/toast";
import { mockUserContextValue } from "../setup/userContext";

type StartResult = RouterOutputs["quests"]["startQuest"];
let selectMission: ComponentProps<typeof MissionPicker.default>["onMissionSelect"];
const startQuest = vi.fn<() => Promise<StartResult>>();
const updateUser = vi.fn(async () => true);
const invalidate = vi.fn(async () => undefined);
const shown = vi.fn<typeof toast.showMutationToast>(() => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(MissionPicker, "default").mockImplementation(({ onMissionSelect }) => {
    selectMission = onMissionSelect;
    return null;
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(shown);
  vi.spyOn(QuestStartCache, "useQuestStartCacheUpdate").mockReturnValue({
    prepareQuestStartUpdate: () => ({}),
    updateQuestStart: invalidate,
  } as never);
  mockUserContextValue({
    prepareUserUpdate: () => 7,
    updateUser,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ quests: { missionHall: { invalidate } } }),
    quests: {
      missionHall: { useQuery: () => ({ data: [] }) },
      startRandom: { useMutation: () => ({ isPending: false }) },
      startQuest: { useMutation: () => ({ mutateAsync: startQuest }) },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["same context", "changed sector", "changed account"] as const)(
  "delivers consumed quest announcements only to their account after %s",
  async (context) => {
    const user = {
      userId: "mission-player",
      sector: 0,
      rank: "JONIN",
      status: "AWAKE",
      level: 50,
      isOutlaw: false,
      userQuests: [],
      questData: [],
      medicalExperience: 0,
      dailyMissions: 0,
      dailyErrands: 0,
      dailyMedicalMissions: 0,
      dailyPvpMissions: 0,
    } as unknown as ComponentProps<typeof MissionHall>["userData"];
    const response: StartResult = {
      success: true,
      message: "Quest started",
      announcements: ["Mission announcement"],
      userPatch: { unreadNotifications: 0, unreadRecruitRewards: 0 },
    };
    let finish!: (result: StartResult) => void;
    startQuest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<MissionHall userData={user} />);
    let pending!: ReturnType<typeof selectMission>;
    act(() => {
      pending = selectMission({ id: "mission", name: "Mission" });
    });
    expect(startQuest).toHaveBeenCalledWith({
      questId: "mission",
      userSector: 0,
      supportsAnnouncements: true,
    });
    if (context !== "same context")
      view.rerender(
        <MissionHall
          userData={{
            ...user,
            sector: context === "changed sector" ? 1 : 0,
            userId: context === "changed account" ? "another-player" : user.userId,
          }}
        />,
      );
    let accepted: boolean | void = false;
    await act(async () => {
      finish(response);
      accepted = await pending;
    });
    expect(accepted).toBe(context === "same context");
    expect(shown).toHaveBeenCalledTimes(context === "changed account" ? 0 : 1);
    if (context !== "changed account") expect(shown).toHaveBeenCalledWith(response);
    expect(updateUser).toHaveBeenCalledTimes(context === "same context" ? 1 : 0);
    expect(invalidate).toHaveBeenCalledTimes(context === "same context" ? 1 : 0);
  },
);
