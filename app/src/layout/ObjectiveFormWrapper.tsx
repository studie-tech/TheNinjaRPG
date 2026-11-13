"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { Quest } from "@/drizzle/schema";
import {
  EditContent,
  EffectFormWrapper,
  FORM_LABEL_MAP,
  type FormEntry,
  rewardCatalogFormEntry,
  unwrapFieldSchema,
} from "@/layout/EditContent";
import { MapLocationPreview } from "@/layout/MapLocationPreview";
import { RewardEditor } from "@/layout/RewardEditor";
import {
  isSupportedOverworldBindingTask,
  placementsForObjective,
} from "@/libs/overworldAi";
import { calculateContentDiff } from "@/utils/diff";
import { canAwardReputation } from "@/utils/permissions";
import type { DeepPartial } from "@/utils/typeutils";
import { useUserDataSelector } from "@/utils/UserContext";
import type { ZodAllTags } from "@/validators/combat";
import { getTagSchema, questBuffTypes, questDebuffTypes } from "@/validators/combat";
import { supportsMapStructure } from "@/validators/mapLocation";
import type { AllObjectivesType } from "@/validators/objectives";
import {
  getObjectiveSchema,
  InstantTasks,
  type RaidTask,
  RaidTasks,
  type SimpleTask,
  SimpleTasks,
} from "@/validators/objectives";

/**
 * Render one objective with schema-derived editor fields.
 * Enemy, ally and random-encounter NPC entries use the db_values_with_number
 * template/count selector; their labels distinguish combatant counts from encounter chances.
 * @returns React.ReactNode
 */
export const ObjectiveFormWrapper: React.FC<ObjectiveFormWrapperProps> = (props) => {
  // Destructure props
  const { idx, objective, objectives, setObjectives } = props;

  // Get user data for permission checks
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const userRole = userData?.role ?? "USER";
  const hasReputationPermission = canAwardReputation(userRole);

  // Get the schema & parse the tag
  const objectiveSchema = getObjectiveSchema(objective.task as string);
  const parsedTag = objectiveSchema.safeParse(objective);
  const shownTag = parsedTag.success ? parsedTag.data : objective;

  // Queries
  const fields = Object.keys(shownTag);
  const hasAIs =
    fields.includes("attackers") ||
    fields.includes("opponentAIs") ||
    fields.includes("allyAIs");
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined, {
    enabled: hasAIs,
  });

  const { data: jutsuData } = api.jutsu.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("reward_jutsus") ||
      fields.includes("trainJutsuIds") ||
      fields.includes("useJutsuIds"),
  });

  const { data: titleData } = api.title.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_titles"),
  });

  const { data: badgeData } = api.badge.getAll.useQuery(undefined, {
    enabled: fields.includes("reward_badges"),
  });

  const { data: itemData } = api.item.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("reward_items") ||
      fields.includes("collectItemIds") ||
      fields.includes("deliverItemIds") ||
      fields.includes("craftItemIds") ||
      fields.includes("buyItemIds") ||
      fields.includes("useItemIds"),
  });

  const { data: sceneBackgrounds } = api.gameAsset.getAllNames.useQuery(
    { type: "SCENE_BACKGROUND", folderPrefix: true },
    { enabled: fields.includes("sceneBackground") },
  );

  const { data: sceneCharacters } = api.gameAsset.getAllNames.useQuery(
    { type: "SCENE_CHARACTER", folderPrefix: true },
    { enabled: fields.includes("sceneCharacters") },
  );

  const { data: quests } = api.quests.getAllNames.useQuery(undefined, {
    enabled: fields.includes("newQuestIds") || fields.includes("completeQuestIds"),
  });

  const { data: structureAssets = [] } = api.mapAsset.getAll.useQuery(undefined, {
    enabled: supportsMapStructure(objective.task),
  });

  const { data: placementNames } = api.overworldAi.getAllPlacementNames.useQuery(
    undefined,
    { enabled: isSupportedOverworldBindingTask(objective.task) },
  );

  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_bloodlines"),
  });

  const { data: sageModes } = api.sageMode.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_sage_modes"),
  });

  // Form for handling the specific tag
  const form = useForm<any>({
    defaultValues: shownTag,
    values: shownTag,
    resolver: zodResolver(objectiveSchema),
    mode: "all",
    reValidateMode: "onBlur",
  });

  // A few fields we need to watch
  const watchAll = useWatch({ control: form.control });
  const watchTask = watchAll.task;
  const watchPlacementId = watchAll.overworldPlacementId;
  const watchOpponentAis = watchAll.opponentAIs;
  const [showStructureDraftFields, setShowStructureDraftFields] = useState(false);

  // When user changes type, we need to update the effects array to re-render form
  useEffect(() => {
    if (watchTask && watchTask !== objective.task) {
      const newObjectives = [...objectives];
      const curObjective = newObjectives?.[idx];
      if (curObjective && watchTask) {
        const tagSchema = getObjectiveSchema(watchTask);
        const parsedTag = tagSchema.safeParse({ id: objective.id, task: watchTask });
        const shownTag = parsedTag.success ? parsedTag.data : objective;
        newObjectives[idx] = { ...shownTag, task: watchTask };
      }
      setObjectives(newObjectives);
    }
  }, [objective, watchTask, idx, objectives]);

  // Trigger re-validation after type changes
  useEffect(() => {
    void form.trigger(undefined, { shouldFocus: true });
  }, [objective.task]);

  // Automatically update the effects whenever dirty
  useEffect(() => {
    const newObjectives = [...objectives];
    const parsedTag = objectiveSchema.safeParse(watchAll);
    // Keep cleared artwork's invalid drafts repairable through correction and blur.
    if (watchAll.structureAssetId) {
      setShowStructureDraftFields(false);
    } else if (
      !parsedTag.success &&
      parsedTag.error.issues.some((issue) =>
        ["locationName", "locationDescription", "structureScale"].includes(
          String(issue.path[0]),
        ),
      )
    ) {
      setShowStructureDraftFields(true);
    }
    const shownTag = parsedTag.success ? parsedTag.data : watchAll;
    if ("id" in shownTag && shownTag.id) {
      newObjectives[idx] = shownTag as AllObjectivesType;
      const diff = calculateContentDiff(objectives, newObjectives);
      if (diff.length > 0) {
        if (objective.task === watchTask) {
          if (form.formState.isDirty) {
            void form.trigger();
          }
          // Parent save validation must see current drafts, including invalid numbers.
          setObjectives(newObjectives);
          // Invalid NaN drafts diff as changed; resetting them would repeat this effect.
          if (parsedTag.success) form.reset(watchAll);
        }
      }
    }
  }, [watchAll]);

  // Attributes on this tag, each of which we should show a form field for
  type Attribute = keyof AllObjectivesType;
  const attributes = Object.keys(objectiveSchema.shape) as Attribute[];

  const sectorType = "sectorType" in watchAll ? watchAll.sectorType : undefined;
  const locationType = "locationType" in watchAll ? watchAll.locationType : undefined;

  // Parse how to present the tag form
  const rewardCatalogs = {
    items: itemData,
    jutsus: jutsuData,
    bloodlines: bloodlines,
    sageModes: sageModes,
    titles: titleData,
    badges: badgeData?.data,
  };
  const objectiveIds = props.objectives.map((objective) => objective.id);
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => value !== "reward_packages")
    .filter(
      (value) =>
        ![
          "structureAssetId",
          "locationName",
          "locationDescription",
          "structureScale",
        ].includes(String(value)) || supportsMapStructure(watchTask),
    )
    .filter(
      (value) =>
        !["locationName", "locationDescription", "structureScale"].includes(
          String(value),
        ) ||
        !!watchAll.structureAssetId ||
        showStructureDraftFields ||
        !objectiveSchema.shape[value].safeParse(watchAll[value]).success,
    )
    .filter(
      (value) =>
        String(value) !== "durationSeconds" ||
        ["espionage", "sabotage"].includes(watchTask),
    )
    .filter(
      (value) =>
        ![
          "applyBuffs",
          "applyDebuffs",
          "task",
          "id",
          "image",
          "item_name",
          "reward",
          "completed",
          // Mastery promotions are claimed only with the quest's final reward.
          "reward_mastery_stat",
          "reward_mastery_rank",
        ].includes(value),
    )
    .filter((value) => {
      return (
        (!SimpleTasks.includes(watchTask as SimpleTask) &&
          watchTask !== "bloodline_collection") ||
        !["latitude", "longitude", "sector"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !sectorType ||
        (sectorType === "specific" && !["sectorList"].includes(value)) ||
        (sectorType === "from_list" && !["sector"].includes(value)) ||
        (["random", "user_village", "current_sector", "enemy_village"].includes(
          sectorType,
        ) &&
          !["sector", "sectorList"].includes(value))
      );
    })
    .filter((value) => {
      return (
        props?.quest?.consecutiveObjectives ||
        !["nextObjectiveId", "failObjectiveId", "resetObjectiveId"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !["fail_quest", "win_quest", "reset_quest"].includes(watchTask) ||
        !["nextObjectiveId"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !([...InstantTasks, "dialog"] as string[]).includes(watchTask) ||
        !["sector", "longitude", "latitude"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !locationType ||
        locationType === "specific" ||
        (locationType === "random" && !["longitude", "latitude"].includes(value))
      );
    })
    .filter((value) => {
      // Hide longitude/latitude for raid tasks - these are set via shrine placement
      return (
        !RaidTasks.includes(watchTask as RaidTask) ||
        !["longitude", "latitude"].includes(value)
      );
    })
    .filter((value) => {
      // The field is part of the shared base schema, but only these tasks have defined
      // overworld interaction semantics. Hiding it prevents invalid content at the source;
      // server save validation is the authoritative backstop.
      return (
        value !== "overworldPlacementId" || isSupportedOverworldBindingTask(watchTask)
      );
    })
    .filter((value) => {
      // Opponent is derived from the bound placement at save; hide manual opponentAIs entry
      // for a placement-bound defeat_opponents objective to avoid double configuration.
      return (
        (value as string) !== "opponentAIs" ||
        watchTask !== "defeat_opponents" ||
        !watchPlacementId
      );
    })
    .map((value) => {
      const innerType = unwrapFieldSchema(objectiveSchema.shape[value]);
      const rewardCatalogEntry = rewardCatalogFormEntry(value, rewardCatalogs);
      if (rewardCatalogEntry) return rewardCatalogEntry;
      if (value === "structureAssetId")
        return {
          id: value,
          type: "db_values",
          label: "Map structure (optional)",
          values: structureAssets,
          searchable: true,
          resetButton: true,
        };
      if (value === "locationName")
        return { id: value, type: "text", label: "Location name" };
      if (value === "locationDescription")
        return {
          id: value,
          type: "textarea",
          label: "Location description (Inspect)",
          doubleWidth: true,
        };
      if (value === "structureScale")
        return { id: value, type: "number", label: "Structure size multiplier" };

      if (
        (["attackers", "opponentAIs", "allyAIs"] as string[]).includes(value) &&
        aiData
      ) {
        return {
          id: value,
          values: [...aiData]
            .sort((a, b) => a.level - b.level)
            .map((ai) => ({
              id: ai.userId,
              name: `lvl ${ai.level}: ${ai.username}`,
            })),
          doubleWidth: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values_with_number",
        };
      } else if (
        [
          "collectItemIds",
          "deliverItemIds",
          "craftItemIds",
          "buyItemIds",
          "useItemIds",
        ].includes(value) &&
        itemData
      ) {
        return {
          id: value,
          values: itemData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (["trainJutsuIds", "useJutsuIds"].includes(value) && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (["sceneBackground"].includes(value) && sceneBackgrounds) {
        return {
          id: value,
          values: sceneBackgrounds,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (["sceneCharacters"].includes(value) && sceneCharacters) {
        return {
          id: value,
          values: sceneCharacters,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (value === "nextObjectiveId" && props.objectives) {
        if (innerType instanceof z.ZodArray) {
          // Dialog objective: nextObjectiveId is an array of {text, nextObjectiveId}
          return {
            id: value,
            doubleWidth: true,
            label: FORM_LABEL_MAP[value] ?? value,
            type: "dialog_options",
            objectiveIds,
          };
        } else {
          return {
            id: value,
            values: objectiveIds,
            type: "str_array",
            label: FORM_LABEL_MAP[value] ?? value,
            resetButton: true,
          };
        }
      } else if (
        ["failObjectiveId", "resetObjectiveId"].includes(value) &&
        props.objectives
      ) {
        return {
          id: value,
          values: objectiveIds,
          type: "str_array",
          label: FORM_LABEL_MAP[value] ?? value,
          resetButton: true,
        };
      } else if (["newQuestIds", "completeQuestIds"].includes(value) && quests) {
        return {
          id: value,
          values: quests,
          multiple: true,
          type: "db_values",
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (value === "overworldPlacementId") {
        // Always render a select (never a free-text fallback) so an arbitrary placement id
        // can't be saved while the names query is still loading or has failed.
        //
        // Narrow the list to placements for the AI chosen in opponentAIs (AI -> placement),
        // so an author picks the AI then its placement. This stays filtered even after a
        // placement is bound: opponentAIs hides (see the filter above) but its value persists,
        // so re-opening the dropdown still shows that enemy's placements, not the full list.
        // deliver_item/dialog instead show only FRIENDLY placements (placementsForObjective).
        const selectedAiIds = (
          (watchOpponentAis as { ids?: string[] }[] | undefined) ?? []
        ).flatMap((o) => o.ids ?? []);
        const matching = placementsForObjective(placementNames ?? [], {
          task: watchTask,
          selectedAiIds,
        });
        return {
          id: value,
          values: matching.map((p) => ({ id: p.id, name: p.label })),
          type: "db_values",
          label: FORM_LABEL_MAP[value] ?? value,
          resetButton: true,
        };
      } else if (["description", "successDescription"].includes(value)) {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "richinput",
          doubleWidth: true,
        };
      } else if (
        innerType instanceof z.ZodLiteral ||
        innerType instanceof z.ZodString
      ) {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "text" };
      } else if (innerType instanceof z.ZodNumber) {
        // Check if this is the reward_reputation field
        const valueStr = String(value);
        const isReputationField = valueStr === "reward_reputation";
        return {
          id: value,
          label:
            valueStr === "value" && watchTask === "espionage"
              ? "Espionage points"
              : valueStr === "value" && watchTask === "sabotage"
                ? "Sabotage damage"
                : (FORM_LABEL_MAP[value] ?? value),
          type: "number",
          readonly: isReputationField && !hasReputationPermission,
        };
      } else if (innerType instanceof z.ZodEnum) {
        return {
          id: value,
          type: "str_array",
          values: innerType.options as string[],
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType.element instanceof z.ZodEnum
      ) {
        const values = (innerType.element as unknown as { options: string[] }).options;
        return {
          id: value,
          type: "str_array",
          values: values,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType.element instanceof z.ZodString
      ) {
        return {
          id: value,
          type: "str_array",
          values: [],
          multiple: true,
          allowAddNew: true,
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (innerType instanceof z.ZodBoolean) {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "boolean" };
      } else {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "text" };
      }
    });

  // Add tag type as first entry
  if (!props.hideTagType) {
    formData.unshift({
      id: "task",
      type: "str_array",
      values: props.availableTags,
    });
  }

  // Re-used EditContent component for actually showing the form
  return (
    <>
      {"applyBuffs" in shownTag && (
        <>
          <QuestBattleEffects
            title="Starting buffs"
            effects={watchAll.applyBuffs ?? []}
            availableTags={questBuffTypes}
            setEffects={(effects) =>
              form.setValue("applyBuffs", effects, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            disabled={props.submitLoading}
          />
          <QuestBattleEffects
            title="Starting debuffs"
            effects={watchAll.applyDebuffs ?? []}
            availableTags={questDebuffTypes}
            setEffects={(effects) =>
              form.setValue("applyDebuffs", effects, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            disabled={props.submitLoading}
          />
        </>
      )}
      {watchAll.structureAssetId && (
        <MapLocationPreview
          isDynamic={Boolean(
            (watchAll.sectorType && watchAll.sectorType !== "specific") ||
              (watchAll.locationType && watchAll.locationType !== "specific") ||
              watchAll.overworldPlacementId,
          )}
          location={{
            id: objective.id,
            sector: Number(watchAll.sector),
            longitude: Number(watchAll.longitude),
            latitude: Number(watchAll.latitude),
            name: watchAll.locationName || "Quest location",
            description: watchAll.locationDescription || "",
            assetId: watchAll.structureAssetId,
            scale: Number(watchAll.structureScale) || 1,
          }}
        />
      )}
      <EditContent
        schema={objectiveSchema}
        form={form}
        formData={formData.filter((entry) => !String(entry.id).startsWith("reward_"))}
        showSubmit={false}
        submitLoading={props.submitLoading}
      >
        <RewardEditor
          form={form}
          formData={formData}
          hideFields={["reward_mastery_stat", "reward_mastery_rank"]}
          isObjectiveReward
        />
      </EditContent>
    </>
  );
};

/** Reuse full combat tag configuration while keeping authored starting effects player-only. */
const QuestBattleEffects = ({
  title,
  effects,
  setEffects,
  availableTags,
  disabled,
}: {
  title: string;
  effects: ZodAllTags[];
  setEffects: (effects: ZodAllTags[]) => void;
  availableTags: readonly ZodAllTags["type"][];
  disabled?: boolean;
}) => (
  <div className="my-4 space-y-3 rounded border p-3">
    <div className="flex items-center justify-between">
      <h3 className="font-bold">{title}</h3>
      <Button
        type="button"
        size="sm"
        disabled={disabled}
        onClick={() => {
          const type = availableTags[0];
          if (type)
            setEffects([
              ...effects,
              getTagSchema(type).parse({ target: "SELF", rounds: 3 }) as ZodAllTags,
            ]);
        }}
      >
        Add effect
      </Button>
    </div>
    <p className="text-muted-foreground text-sm">
      Applies to the player. Duration includes the opening round.
    </p>
    {effects.map((effect, idx) => (
      <div key={`${effect.type}-${idx}`} className="rounded border p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setEffects(effects.filter((_, i) => i !== idx))}
        >
          Remove effect {idx + 1}
        </Button>
        <EffectFormWrapper
          idx={idx}
          type="jutsu"
          tag={effect}
          effects={effects}
          availableTags={availableTags}
          editableFields={Object.keys(getTagSchema(effect.type).shape).filter(
            (field) => field !== "target" && field !== "friendlyFire",
          )}
          submitLoading={disabled}
          setEffects={(values) =>
            setEffects(values.map((tag) => ({ ...tag, target: "SELF" })))
          }
        />
      </div>
    ))}
  </div>
);

interface ObjectiveFormWrapperProps {
  idx: number;
  quest: DeepPartial<Quest>;
  availableTags: readonly string[];
  hideTagType?: boolean;
  objective: AllObjectivesType;
  objectives: AllObjectivesType[];
  setObjectives: (content: AllObjectivesType[]) => void;
  submitLoading?: boolean;
}
