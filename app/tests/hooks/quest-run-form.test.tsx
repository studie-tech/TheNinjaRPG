import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { Quest } from "@/drizzle/schema";
import { useQuestEditForm } from "@/hooks/quest";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import {
  InstantStartBattleObjective,
  QuestFormSchema,
  QuestValidator,
  RaidObjective,
  SimpleObjective,
} from "@/validators/objectives";
import { mockUserContextValue } from "../setup/userContext";

const tickets = [{ ids: ["ticket"], number: 2 }];
const floor = InstantStartBattleObjective.parse({
  id: "floor",
  task: "start_battle",
  opponentAIs: [{ ids: ["foe"], number: 1 }],
});
const savedQuest = {
  ...QuestValidator.parse({
    name: "Ticketed Pyramid",
    description: "Enter",
    successDescription: "Done",
    questType: "battlepyramid",
    hidden: false,
    consecutiveObjectives: false,
    endsAt: null,
    startsAt: null,
    tierLevel: null,
    content: { entryItems: tickets, isolated: true, objectives: [floor], reward: {} },
  }),
  id: "pyramid",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Quest;
const save = vi.fn(async (_input: unknown) => ({ success: true }));
const names = { useQuery: () => ({ data: [], isPending: false }) };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    item: { getAllNames: names },
    jutsu: { getAllNames: names },
    profile: { getAllAiNames: names },
    village: { getAllNames: names },
    title: { getAllNames: names },
    badge: { getAll: names },
    gameAsset: { getAllNames: names },
    bloodline: { getAllNames: names },
    sageMode: { getAllNames: names },
    quests: {
      getAllNames: names,
      update: { useMutation: () => ({ mutateAsync: save, isPending: false }) },
    },
  });
  mockUserContextValue({
    data: { role: "OWNER" },
  } as never);
  vi.spyOn(toast, "showFormErrorsToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("quest run editor validation and payload", () => {
  it("saves layout-only edits and reloads their shared positions", async () => {
    const positions = { floor: { x: -125.5, y: 300 } };
    const { result, unmount } = renderHook(() =>
      useQuestEditForm(structuredClone(savedQuest), async () => undefined),
    );
    await act(async () => {
      result.current.setNodePositions(positions);
    });
    expect(result.current.getSuggestionData()).toMatchObject({
      content: { nodePositions: positions },
    });
    await act(async () => {
      await result.current.handleQuestSubmit();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { content: { nodePositions: positions } },
    });
    unmount();
    const reopened = {
      ...structuredClone(savedQuest),
      content: { ...savedQuest.content, nodePositions: positions },
    };
    const next = renderHook(() => useQuestEditForm(reopened, async () => undefined));
    expect(next.result.current.currentValues.content.nodePositions).toEqual(positions);
  });

  it("retains arranged nodes when adding objectives and removes deleted coordinates", async () => {
    const quest = {
      ...structuredClone(savedQuest),
      content: { ...savedQuest.content, nodePositions: { floor: { x: 40, y: 90 } } },
    };
    const { result } = renderHook(() => useQuestEditForm(quest, async () => undefined));
    await act(async () => {
      result.current.setObjectives([floor, { ...floor, id: "copy" }]);
    });
    expect(result.current.currentValues.content.nodePositions).toEqual(
      quest.content.nodePositions,
    );
    await act(async () => {
      result.current.setObjectives([{ ...floor, id: "copy" }]);
    });
    expect(result.current.getSuggestionData()?.content.nodePositions).toEqual({});
  });

  it.each(["raid", "village_mission", "achievement", "story"] as const)(
    "converts a saved ticketed isolated Pyramid to %s before validation",
    async (questType) => {
      const { result } = renderHook(() =>
        useQuestEditForm(structuredClone(savedQuest), async () => undefined),
      );
      await act(async () => {
        result.current.form.setValue("questType", questType);
        if (questType === "raid") {
          result.current.setObjectives([
            RaidObjective.parse({
              id: "raid",
              task: "open_raid",
              sector: 1,
              opponentAIs: [{ ids: ["foe"], number: 1 }],
            }),
          ]);
          result.current.form.setValue("raidBossMaxHealth", 100);
          result.current.form.setValue("raidBossCurrentHealth", 100);
        } else if (questType === "village_mission") {
          result.current.setObjectives([
            SimpleObjective.parse({
              id: "kills",
              task: "pvp_kills",
              description: "Defeat enemies",
              value: 10,
            }),
          ]);
          result.current.form.setValue("content.reward.reward_tokens", 100);
          result.current.form.setValue("reward_tokens", 100);
        }
      });
      // Validate the original form state, before either save/suggestion serializer runs.
      const parsed = QuestFormSchema.safeParse(result.current.form.getValues());
      expect(parsed.success).toBe(true);
      if (parsed.success)
        expect(parsed.data.content).toMatchObject({
          entryItems: questType === "story" ? tickets : [],
          isolated: false,
        });
      let valid = false;
      await act(async () => {
        valid = await result.current.form.trigger();
        await result.current.handleQuestSubmit();
      });
      expect(valid).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]?.[0]).toMatchObject({
        data: {
          questType,
          content: {
            entryItems: questType === "story" ? tickets : [],
            isolated: false,
          },
        },
      });
      expect(result.current.getSuggestionData()).toMatchObject({
        content: { entryItems: questType === "story" ? tickets : [], isolated: false },
      });
      expect(toast.showFormErrorsToast).not.toHaveBeenCalled();
    },
  );

  it("validates newly added tickets against the edited objectives", async () => {
    const quest = structuredClone(savedQuest);
    quest.content.entryItems = [];
    quest.content.objectives = [];
    const { result } = renderHook(() => useQuestEditForm(quest, async () => undefined));
    await act(async () => {
      result.current.form.setValue("entryItems", tickets);
      await result.current.handleQuestSubmit();
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.getSuggestionData()).toBeNull();
    await act(async () => {
      result.current.setObjectives([floor]);
    });
    await act(async () => {
      await result.current.handleQuestSubmit();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { content: { entryItems: tickets } },
    });
  });

  it("validates cleared entry items and isolation instead of the saved nested values", async () => {
    const { result } = renderHook(() =>
      useQuestEditForm(structuredClone(savedQuest), async () => undefined),
    );
    await act(async () => {
      result.current.form.setValue("entryItems", []);
      result.current.form.setValue("isolated", false);
      result.current.setObjectives([]);
    });
    const parsed = QuestFormSchema.safeParse(result.current.form.getValues());
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.content).toMatchObject({ entryItems: [], isolated: false });
    await act(async () => {
      await result.current.handleQuestSubmit();
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { content: { entryItems: [], isolated: false } },
    });
  });

  it("keeps server validation strict for collective tickets and non-Pyramid isolation", () => {
    for (const questType of ["raid", "village_mission", "achievement"] as const) {
      const parsed = QuestValidator.safeParse({
        ...savedQuest,
        questType,
        content: { ...savedQuest.content, isolated: false },
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(
          parsed.error.issues.some(
            (issue) => issue.path.join(".") === "content.entryItems",
          ),
        ).toBe(true);
    }
    expect(
      QuestValidator.safeParse({ ...savedQuest, questType: "story" }).success,
    ).toBe(false);
  });
});
