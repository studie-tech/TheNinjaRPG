import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  GATHERING_RANKS,
  HUNTING_RANKS,
  IMG_AVATAR_DEFAULT,
  IMG_BADGE_DIALOG,
  isPetTaskQuestType,
  isSharedRunQuestType,
  LetterRanks,
  MASTERY_RANKS,
  MasteryNames,
  MasteryTypes,
  MEDNIN_RANKS,
  QUEST_REWARD_MODES,
  QUEST_REWARD_PICK_MAX,
  QuestTypes,
  QuestTypesWithMaxAttempts,
  RetryQuestDelays,
  SAGE_MASTERY_RANKS,
  STARTER_VILLAGES,
  UserRanks,
} from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import { useContentSubmit } from "@/hooks/contentSubmit";
import type { FormEntry } from "@/layout/EditContent";
import { MASTERY_REQUIREMENT_FIELDS } from "@/libs/mastery";
import { expandAiCopies } from "@/libs/quest";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { canAwardReputation } from "@/utils/permissions";
import { objectKeys } from "@/utils/typeutils";
import { useUserDataSelector } from "@/utils/UserContext";
import type {
  AllObjectivesType,
  QuestNodePositions,
  ZodQuestFormInput,
  ZodQuestFormType,
} from "@/validators/objectives";
import { QuestFormSchema } from "@/validators/objectives";
import { type QuestRewardType, questRewardFields } from "@/validators/rewardPackages";
import { MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";

/** Manage quest fields, objective layouts and validated content saves in one form. */
export const useQuestEditForm = (quest: Quest, refetch: () => Promise<unknown>) => {
  const submitContent = useContentSubmit();

  // Get user data for permission checks
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const userRole = userData?.role ?? "USER";
  const hasReputationPermission = canAwardReputation(userRole);

  // Form handling
  const endsAt = quest.endsAt ? quest.endsAt.slice(0, 10) : "";
  const startsAt = quest.startsAt ? quest.startsAt.slice(0, 10) : "";
  const initialData = {
    ...quest,
    ...quest.content.reward,
    entryItems: quest.content.entryItems ?? [],
    isolated: quest.content.isolated ?? false,
    sceneBackground: quest.content.sceneBackground,
    sceneCharacters: quest.content.sceneCharacters,
    rewardMode: quest.content.rewardMode ?? "all",
    rewardPickCount: quest.content.rewardPickCount ?? 1,
    endsAt: endsAt,
    startsAt: startsAt,
  };
  const parsedStart = QuestFormSchema.safeParse(initialData);
  const start = parsedStart.success ? parsedStart.data : initialData;

  const form = useForm<ZodQuestFormInput, unknown, ZodQuestFormType>({
    mode: "all",
    criteriaMode: "all",
    values: start as ZodQuestFormInput,
    defaultValues: start as ZodQuestFormInput,
    resolver: zodResolver(QuestFormSchema),
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
  const { data: sageModes, isPending: l10 } =
    api.sageMode.getAllNames.useQuery(undefined);

  const { data: titles, isPending: l11 } = api.title.getAllNames.useQuery();

  // Mutation for updating the quest
  const utils = api.useUtils();
  const { mutateAsync: updateQuest, isPending: isUpdating } =
    api.quests.update.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (!data.success) return;

        // Keep the editor locked until both authoritative views have settled. Cache refreshes
        // happen after the server has committed, so their failure must never make the save look
        // retryable (and risk submitting the same update again).
        await Promise.allSettled([
          refetch(),
          utils.quests.getAchievementCatalogue.invalidate(),
        ]);
      },
    });

  /** The quest.update payload for validated form values; shared by saving and suggesting. */
  const toQuestPayload = (data: ZodQuestFormType) => {
    const newObjectives = data.content.objectives.map((objective) => {
      if (objective.task === "move_to_location" && data.image) {
        objective.image = data.image;
      } else if (objective.task === "collect_item") {
        objective.image = IMG_AVATAR_DEFAULT;
        objective.item_name = "Unknown";
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
        const opponentIds = expandAiCopies(objective.opponentAIs).filter(
          (id): id is string => id !== undefined,
        );
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
        nodePositions: data.content.nodePositions,
        entryItems: data.content.entryItems,
        isolated: data.content.isolated,
        sceneBackground: data.sceneBackground,
        sceneCharacters: data.sceneCharacters,
        objectives: newObjectives,
        rewardMode: data.rewardMode,
        rewardPickCount: data.rewardPickCount,
        reward: Object.fromEntries(
          objectKeys(questRewardFields).map((key) => [key, data[key]]),
        ) as QuestRewardType,
      },
    };
    return newQuest;
  };

  // Form submission
  const handleQuestSubmit = form.handleSubmit(
    async (data: ZodQuestFormType) => {
      await submitContent(quest, toQuestPayload(data), (newQuest) =>
        updateQuest({ id: quest.id, data: newQuest }),
      );
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Watch the quest content
  const content = useWatch({
    control: form.control,
    name: "content",
  });
  // Cast to output type - z.coerce fields have unknown in input type but proper types in output
  const objectives = (content.objectives ?? []) as AllObjectivesType[];

  // Watch the entire thing - cast to output type for proper typing with z.coerce fields
  const currentValues = useWatch({
    control: form.control,
  }) as ZodQuestFormType;

  /** Replace objectives while retaining saved positions only for remaining nodes. */
  const setObjectives = (values: AllObjectivesType[]) => {
    // Cast content to output type for proper typing
    const newContent = {
      ...(content as ZodQuestFormType["content"]),
      objectives: values,
      nodePositions: content.nodePositions
        ? Object.fromEntries(
            values.flatMap(({ id }) =>
              content.nodePositions?.[id] ? [[id, content.nodePositions[id]]] : [],
            ),
          )
        : undefined,
    };
    form.setValue("content", newContent, { shouldDirty: true });
  };

  /** Include graph arrangements in the next quest save without changing objectives. */
  const setNodePositions = useCallback(
    (positions: QuestNodePositions) => {
      form.setValue("content.nodePositions", positions, { shouldDirty: true });
    },
    [form],
  );

  // Are we loading data
  const loading = l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8 || l9 || l10 || l11;

  // Watch for changes
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });
  const questType = useWatch({
    control: form.control,
    name: "questType",
  });
  const rewardMode = useWatch({
    control: form.control,
    name: "rewardMode",
  });

  const teamEnabled = useWatch({ control: form.control, name: "teamEnabled" });

  // Object for form values
  const formData: FormEntry<keyof ZodQuestFormType>[] = [
    { id: "name", label: "Title", type: "text" },
    { id: "hidden", type: "boolean", label: "Hidden" },
    {
      id: "publicLocations",
      type: "boolean",
      label: "Show structures to all players (Inspect only)",
    },
    { id: "consecutiveObjectives", type: "boolean", label: "Sequential Objectives" },
    {
      id: "teamEnabled",
      type: "boolean",
      label: "Allow quest teams",
    },
    ...(teamEnabled
      ? [
          {
            id: "teamMaxPlayers",
            type: "number",
            label: "Maximum quest party members",
          } as const,
        ]
      : []),
    { id: "questType", type: "str_array", values: QuestTypes },
    { id: "questRank", type: "str_array", values: LetterRanks },
    { id: "medicalRank", type: "str_array", values: MEDNIN_RANKS },
    { id: "huntingRank", type: "str_array", values: HUNTING_RANKS },
    { id: "gatheringRank", type: "str_array", values: GATHERING_RANKS },
    { id: "requiredLevel", type: "number" },
    {
      id: "requiredFarmingLevel",
      type: "number",
      label: "Required Farming Level",
    },
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

  if (items && !isSharedRunQuestType(questType))
    formData.push({
      id: "entryItems",
      type: "db_values_with_number",
      values: items,
      doubleWidth: true,
      label: "Entry items (quantity consumed on entry)",
    });
  if (questType === "battlepyramid")
    formData.push({
      id: "isolated",
      type: "boolean",
      label: "Isolated run (no outside activities)",
    });
  if (isPetTaskQuestType(questType))
    formData.push({
      id: "petTaskMinutes",
      type: "number",
      label: "Companion task duration (minutes; blank disables)",
      resetButton: true,
    });

  if (QuestTypesWithMaxAttempts.includes(questType)) {
    formData.push({ id: "maxAttempts", type: "number", label: "Max Attempts" });
    formData.push({ id: "maxCompletes", type: "number", label: "Max Completes" });
    formData.push({ id: "retryDelay", type: "str_array", values: RetryQuestDelays });
  }
  formData.push({
    id: "attemptDelay",
    type: "str_array",
    values: RetryQuestDelays,
    label: "Overworld Roll Delay",
  });

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

  // Add bloodlines if they exist
  if (bloodlines) {
    formData.push({
      id: "requiredBloodlineId",
      type: "db_values",
      values: bloodlines,
      resetButton: true,
      label: "Required Bloodline",
    });
  }

  // Add sage modes if they exist
  if (sageModes) {
    formData.push({
      id: "requiredSageModeId",
      type: "db_values",
      values: sageModes,
      resetButton: true,
      label: "Required Sage Mode",
    });
  }

  formData.push({
    id: "requiredSageRank",
    type: "str_array",
    values: SAGE_MASTERY_RANKS.filter((r) => r !== "NONE"),
    resetButton: true,
    label: "Required Sage Rank (min mastery — INITIATE = any sage user)",
  });

  for (const [field, , label] of MASTERY_REQUIREMENT_FIELDS)
    formData.push({ id: field, type: "number", label: `Minimum Earned ${label}` });
  formData.push({ id: "description", type: "richinput", doubleWidth: true });
  formData.push({ id: "successDescription", type: "richinput", doubleWidth: true });

  // Availability window
  formData.push({ id: "endsAt", type: "date", label: "Ends At" });
  formData.push({ id: "startsAt", type: "date", label: "Starts At" });

  // For tiers, add tier level
  if (questType === "tier") {
    formData.push({ id: "tierLevel", type: "number" });
  }

  // For raids, add raid-specific fields (AI and sector are in the objective)
  if (questType === "raid") {
    formData.push({
      id: "raidMaxPlayers",
      type: "number",
      label: "Maximum players per raid team",
    });
    formData.push({
      id: "raidBossMaxHealth",
      type: "number",
      label: "Boss Max Health",
    });
    formData.push({
      id: "raidBossCurrentHealth",
      type: "number",
      label: "Boss Current Health",
    });
  }

  // Rewards
  formData.push({
    id: "rewardMode",
    type: "str_array",
    values: QUEST_REWARD_MODES,
    label: "Reward Mode (all, or player chooses)",
  });
  if (rewardMode === "choose") {
    formData.push({
      id: "rewardPickCount",
      type: "number",
      label: `Rewards to Choose (1-${QUEST_REWARD_PICK_MAX}; rank, village & materials always given)`,
    });
  }
  formData.push({ id: "reward_hunter_items", type: "boolean" });
  formData.push({ id: "reward_gathering_items", type: "boolean" });
  formData.push({
    id: "reward_hunter_items_ids",
    type: "db_values",
    values: items?.filter((i) => i.canBeHunted) ?? [],
    multiple: true,
    label: "Valid Reward Hunter Items",
  });
  formData.push({
    id: "reward_gathering_items_ids",
    type: "db_values",
    values: items?.filter((i) => i.canBeGathered) ?? [],
    multiple: true,
    label: "Valid Reward Gathering Items",
  });
  formData.push({ id: "reward_money", type: "number" });
  formData.push({ id: "reward_seichi_silver", type: "number" });
  formData.push({ id: "reward_clanpoints", type: "number" });
  formData.push({ id: "reward_anbupoints", type: "number" });
  formData.push({ id: "reward_exp", type: "number" });
  formData.push({
    id: "reward_pet_experience",
    type: "number",
    label: "Pet Experience (eligible active pet only)",
  });
  formData.push({
    id: "reward_level",
    type: "number",
    label: "Elite Jonin Milestone Level (0 disables)",
  });
  formData.push({
    id: "reward_stats",
    type: "number",
    label: "Milestone Gain per Combat Stat",
  });
  formData.push({ id: "reward_tokens", type: "number" });
  formData.push({ id: "reward_prestige", type: "number" });
  formData.push({
    id: "reward_reputation",
    type: "number",
    readonly: !hasReputationPermission,
  });
  formData.push({ id: "reward_skillpoints", type: "number" });
  formData.push({ id: "reward_medical_experience", type: "number" });
  formData.push({ id: "reward_hunting_experience", type: "number" });
  formData.push({ id: "reward_crafting_experience", type: "number" });
  formData.push({ id: "reward_gathering_experience", type: "number" });
  formData.push({
    id: "reward_sage_mastery_experience",
    type: "number",
    label: "Sage Mode XP",
  });
  for (const [index, field] of MASTERY_EXPERIENCE_FIELDS.entries())
    formData.push({
      id: field,
      type: "number",
      label: `${MasteryTypes[index]} Mastery XP`,
    });
  formData.push({
    id: "reward_mastery_stat",
    type: "str_array",
    values: ["None", ...MasteryNames],
    label: "Mastery to Rank Up",
  });
  formData.push({
    id: "reward_mastery_rank",
    type: "str_array",
    values: MASTERY_RANKS,
    label: "Mastery Rank Reward",
  });
  formData.push({ id: "reward_war_damage", type: "number" });
  formData.push({ id: "reward_war_healing", type: "number" });
  formData.push({ id: "reward_rank", type: "str_array", values: UserRanks });
  formData.push({
    id: "reward_village_membership",
    type: "str_array",
    values: STARTER_VILLAGES,
  });

  if (bloodlines) {
    formData.push({
      id: "reward_bloodlines",
      type: "db_values",
      values: bloodlines,
      multiple: true,
    });
  }

  if (sageModes) {
    formData.push({
      id: "reward_sage_modes",
      type: "db_values",
      values: sageModes,
      multiple: true,
    });
  }

  // Add items if they exist
  if (items) {
    formData.push({
      id: "reward_items",
      type: "db_values_with_number",
      values: items,
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

  if (titles)
    formData.push({
      id: "reward_titles",
      label: "Give Title",
      type: "db_values",
      values: titles,
      multiple: true,
    });

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

  /** What a suggestion sends: the save payload, or null while the form does not validate. */
  const getSuggestionData = () => {
    const parsed = QuestFormSchema.safeParse(form.getValues());
    return parsed.success ? toQuestPayload(parsed.data as ZodQuestFormType) : null;
  };

  return {
    currentValues,
    objectives,
    form,
    formData,
    loading,
    setObjectives,
    setNodePositions,
    handleQuestSubmit,
    getSuggestionData,
    isUpdating,
  };
};
