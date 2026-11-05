import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import type { QuestType, UserRole } from "@/drizzle/constants";
import { QuestTypes } from "@/drizzle/constants";
import type { UserQuest } from "@/drizzle/schema";
import * as tutorial from "@/hooks/tutorial";
import * as rewardCache from "@/hooks/useQuestRewardCacheUpdate";
import { LogbookEntry } from "@/layout/Logbook";
import * as rewardChoice from "@/layout/RewardChoice";
import { canAbandonQuestType } from "@/utils/permissions";
import * as userContext from "@/utils/UserContext";
import type { QuestTrackerType } from "@/validators/objectives";

const mutation = () => ({ useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) });

const renderEntry = (role: UserRole, questType: QuestType) => {
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: { role, status: "AWAKE", userQuests: [], questData: [] },
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
  } as unknown as ReturnType<typeof userContext.useRequiredUserData>);
  const quest = {
    id: "quest",
    name: "Patrol",
    questType,
    description: "",
    content: { objectives: [], reward: {}, sceneBackground: "", sceneCharacters: [] },
  };
  const userQuest = { id: "attempt", quest, startedAt: new Date(0) } as unknown as UserQuest & {
    quest: typeof quest;
  };
  return render(
    <LogbookEntry
      userQuest={userQuest as never}
      tracker={{ id: "quest", goals: [] } as unknown as QuestTrackerType}
      hideTitle
    />,
  );
};

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    gameAsset: { getSceneAssets: { useQuery: () => ({ data: undefined }) } },
    quests: { abandon: mutation(), checkRewards: mutation(), storyQuestGains: mutation() },
  });
  vi.spyOn(rewardCache, "useQuestRewardCacheUpdate").mockReturnValue({
    prepareQuestRewardUpdate: vi.fn(),
    updateQuestRewards: vi.fn(),
  } as unknown as ReturnType<typeof rewardCache.useQuestRewardCacheUpdate>);
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    currentStep: undefined,
    completeTutorialAction: vi.fn(),
  } as unknown as ReturnType<typeof tutorial.useTutorialStep>);
  vi.spyOn(rewardChoice, "useOpenRewardChoice").mockReturnValue(vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Logbook abandon control", () => {
  it.each(QuestTypes)("offers %s to exactly the roles the shared rule allows", (questType) => {
    for (const role of ["USER", "MODERATOR"] as const) {
      const view = renderEntry(role, questType);
      const button = view.queryByRole("button", { name: "Abandon Patrol" });
      expect(!!button).toBe(canAbandonQuestType(role, questType));
      view.unmount();
    }
  });

  it("follows the server for regular players on war and ANBU quests", () => {
    expect(renderEntry("USER", "war").queryByRole("button", { name: "Abandon Patrol" })).toBeTruthy();
    cleanup();
    expect(renderEntry("USER", "anbu").queryByRole("button", { name: "Abandon Patrol" })).toBeNull();
  });

  it("offers staff every quest type", () => {
    expect(renderEntry("CODER", "anbu").queryByRole("button", { name: "Abandon Patrol" })).toBeTruthy();
    expect(QuestTypes.every((type) => canAbandonQuestType("MODERATOR", type))).toBe(true);
  });
});
