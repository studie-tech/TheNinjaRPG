import { calculateContentDiff } from "@/utils/diff";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { QuestValidator, ObjectiveReward } from "@/validators/objectives";
import {
  LetterRanks,
  QuestTypes,
  UserRanks,
  RetryQuestDelays,
} from "@/drizzle/constants";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
import { IMG_AVATAR_DEFAULT, IMG_BADGE_DIALOG } from "@/drizzle/constants";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import type { AllObjectivesType } from "@/validators/objectives";
import type { Quest } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import type { ZodQuestType, QuestContentType } from "@/validators/objectives";
import type { ObjectiveRewardType } from "@/validators/objectives";

// A merged type for quest with its rewards, so that we can show both in the same form
type ZodCombinedQuest = ZodQuestType &
  ObjectiveRewardType & {
    sceneBackground: string;
    sceneCharacters: string[];
  };

/**
 * Hook used when creating frontend forms for editing items
 * @param data
 */
export const useQuestEditForm = (quest: Quest, refetch: () => void) => {
  // Schema used
  const schema = QuestValidator._def.schema.merge(ObjectiveReward).merge(
    z.object({
      sceneBackground: z.string().default(""),
      sceneCharacters: z.array(z.string()).default([]),
    }),
  );

  // Form handling
  const endsAt = quest.endsAt ? quest.endsAt.slice(0, 10) : "";
  const startsAt = quest.startsAt ? quest.startsAt.slice(0, 10) : "";
  const initialData = {
    ...quest,
    ...quest.content.reward,
    sceneBackground: quest.content.sceneBackground,
    sceneCharacters: quest.content.sceneCharacters,
    endsAt: endsAt,
    startsAt: startsAt,
  };
  const parsedStart = schema.safeParse(initialData);
  const start = parsedStart.success ? parsedStart.data : initialData;

  const form = useForm<ZodCombinedQuest>({
    mode: "all",
    criteriaMode: "all",
    values: start,
    defaultValues: start,
    resolver: zodResolver(schema),
  });

  // Query for relations
  const { data: items, isPending: l1 } = api.item.getAllNames.useQuery(undefined);
  const { data: jutsus, isPending: l2 } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: ais, isPending: l3 } = api.profile.getAllAiNames.useQuery(undefined);
  const { data: villages, isPending: l4 } = api.village.getAllNames.useQuery(undefined);
  const { data: badges, isPending: l5 } = api.badge.getAll.useQuery(undefined);
  const { data: quests, isPending: l6 } = api.quests.getAllNames.useQuery(undefined);
  const { data: sceneBackgrounds, isPending: l7 } = api.gameAsset.getAllNames.useQuery({
    type: "SCENE_BACKGROUND",
    folderPrefix: true,
  });
  const { data: sceneCharacters, isPending: l8 } = api.gameAsset.getAllNames.useQuery({
    type: "SCENE_CHARACTER",
    folderPrefix: true,
  });
  const { data: bloodlines, isPending: l9 } =
    api.bloodline.getAllNames.useQuery(undefined);

  // Mutation for updating item
  const { mutate: updateQuest } = api.quests.update.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      refetch();
    },
  });

  // Form submission
  const handleQuestSubmit = form.handleSubmit(
    (data: ZodCombinedQuest) => {
      const newObjectives = data.content.objectives.map((objective) => {
        if (objective.task === "move_to_location" && data.image) {
          objective.image = data.image;
        } else if (objective.task === "collect_item") {
          const subset = items?.filter((i) => objective.collectItemIds.includes(i.id));
          if (subset && subset.length > 0) {
            objective.image = subset?.[0]?.image || IMG_AVATAR_DEFAULT;
            objective.item_name = subset.map((i) => i.name).join(", ");
          }
        } else if (objective.task === "deliver_item") {
          const subset = items?.filter((i) => objective.deliverItemIds.includes(i.id));
          if (subset && subset.length > 0) {
            objective.image = subset?.[0]?.image || IMG_AVATAR_DEFAULT;
            objective.item_name = subset.map((i) => i.name).join(", ");
          }
        } else if (objective.task === "defeat_opponents") {
          const opponentIds = objective.opponentAIs
            .flatMap((o) => Array(o.number).fill(o.ids).flat() as string[])
            .filter((id): id is string => id !== undefined);
          const ai = ais?.find((u) => opponentIds.includes(u.userId));
          if (ai?.avatar) {
            objective.image = ai.avatar;
          }
        } else if (objective.task === "dialog") {
          objective.image = IMG_BADGE_DIALOG;
        }
        return objective;
      });
      const newQuest = {
        ...quest,
        ...data,
        endsAt: data.endsAt ? data.endsAt : null,
        startsAt: data.startsAt ? data.startsAt : null,
        content: {
          sceneBackground: data.sceneBackground,
          sceneCharacters: data.sceneCharacters,
          objectives: newObjectives,
          reward: {
            reward_money: data.reward_money,
            reward_seichi_silver: data.reward_seichi_silver,
            reward_clanpoints: data.reward_clanpoints,
            reward_exp: data.reward_exp,
            reward_tokens: data.reward_tokens,
            reward_prestige: data.reward_prestige,
            reward_reputation: data.reward_reputation,
            reward_jutsus: data.reward_jutsus,
            reward_badges: data.reward_badges,
            reward_items: data.reward_items,
            reward_rank: data.reward_rank,
            reward_bloodlines: data.reward_bloodlines,
          },
        },
      };
      const diff = calculateContentDiff(quest, newQuest);
      if (diff.length > 0) {
        updateQuest({ id: quest.id, data: newQuest });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Watch the effects
  const content = useWatch({
    control: form.control,
    name: "content",
  });
  const objectives = content.objectives ?? [];

  // Handle updating of effects
  const setObjectives = (values: AllObjectivesType[]) => {
    const newContent: QuestContentType = { ...content, objectives: values };
    form.setValue("content", newContent, { shouldDirty: true });
  };

  // Are we loading data
  const loading = l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8 || l9;

  // Watch for changes
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });
  const questType = useWatch({
    control: form.control,
    name: "questType",
  });
  const consecutiveObjectives = useWatch({
    control: form.control,
    name: "consecutiveObjectives",
  });

  // Object for form values
  const formData: FormEntry<keyof ZodCombinedQuest>[] = [
    { id: "name", label: "Title", type: "text" },
    { id: "hidden", type: "boolean", label: "Hidden" },
    { id: "consecutiveObjectives", type: "boolean", label: "Sequential Objectives" },
    { id: "questType", type: "str_array", values: QuestTypes },
    { id: "questRank", type: "str_array", values: LetterRanks },
    { id: "requiredLevel", type: "number" },
    { id: "maxLevel", type: "number", label: "Max Level" },
    {
      id: "sceneBackground",
      type: "db_values",
      values: sceneBackgrounds,
      label: "Background (if not sequential)",
    },
    {
      id: "sceneCharacters",
      type: "db_values",
      values: sceneCharacters,
      multiple: true,
      label: "Characters (if not sequential)",
    },
  ];

  if (questType === "event" || questType === "story") {
    formData.push({ id: "maxAttempts", type: "number", label: "Max Attempts" });
    formData.push({ id: "maxCompletes", type: "number", label: "Max Completes" });
    formData.push({ id: "retryDelay", type: "str_array", values: RetryQuestDelays });
  }

  // Add prerequisite quest if quests exist
  if (quests) {
    formData.push({
      id: "prerequisiteQuestId",
      type: "db_values",
      values: quests.filter((q) => q.id !== quest.id), // Don't allow self-reference
      resetButton: true,
      label: "Prerequisite Quest",
      searchable: true,
    });
  }

  // Add villages if they exist
  if (villages) {
    formData.push({
      id: "requiredVillage",
      type: "db_values",
      values: villages,
      resetButton: true,
    });
  }

  // For tiers, add tier level
  if (questType === "tier") {
    formData.push({ id: "tierLevel", type: "number" });
  }

  // Rewards
  formData.push({ id: "reward_money", type: "number" });
  formData.push({ id: "reward_seichi_silver", type: "number" });
  formData.push({ id: "reward_clanpoints", type: "number" });
  formData.push({ id: "reward_exp", type: "number" });
  formData.push({ id: "reward_tokens", type: "number" });
  formData.push({ id: "reward_prestige", type: "number" });
  formData.push({ id: "reward_reputation", type: "number" });
  formData.push({ id: "reward_rank", type: "str_array", values: UserRanks });

  if (bloodlines) {
    formData.push({
      id: "reward_bloodlines",
      type: "db_values",
      values: bloodlines,
    });
  }

  // Add items if they exist
  if (items) {
    formData.push({
      id: "reward_items",
      type: "db_values_with_number",
      values: items.sort((a, b) => a.name.localeCompare(b.name)),
      multiple: true,
      doubleWidth: true,
      label: "Reward Items [and drop chance%]",
    });
  }

  // Add jutsus if they exist
  if (jutsus) {
    formData.push({
      id: "reward_jutsus",
      type: "db_values",
      values: jutsus,
      multiple: true,
    });
  }

  // Add badges if they exist
  if (badges?.data) {
    formData.push({
      id: "reward_badges",
      type: "db_values",
      values: badges.data,
      multiple: true,
    });
  }

  // Image & description
  formData.unshift({ id: "image", type: "avatar", href: imageUrl });
  formData.push({ id: "description", type: "richinput", doubleWidth: true });
  formData.push({ id: "successDescription", type: "richinput", doubleWidth: true });

  // Add description & image only for missions/crimes/events
  formData.push({ id: "endsAt", type: "date", label: "Ends At" });
  formData.push({ id: "startsAt", type: "date", label: "Starts At" });

  return {
    quest,
    objectives,
    form,
    formData,
    loading,
    consecutiveObjectives,
    setObjectives,
    handleQuestSubmit,
  };
};
