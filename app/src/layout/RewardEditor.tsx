"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { nanoid } from "nanoid";
import type React from "react";
import { useEffect, useState } from "react";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContentType } from "@/drizzle/constants";
import {
  EditContent,
  FORM_LABEL_MAP,
  type FormEntry,
  rewardCatalogFormEntry,
  unwrapFieldSchema,
} from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { getRewardPreview } from "@/libs/objectives";
import { getActiveRewardNodes } from "@/libs/rewardNodes";
import { showFormErrorsToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import { canAwardReputation, isStaffRole } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import {
  MAX_REWARD_PACKAGES,
  QuestReward,
  type RewardPackageSnapshotType,
} from "@/validators/rewardPackages";
import {
  ObjectiveReward,
  type ObjectiveRewardType,
  rewardFields,
} from "@/validators/rewards";

/** Edit grouped rewards, repeat groups as independent nodes, and attach catalog snapshots. */
export const RewardEditor = ({
  form,
  formData,
  type,
  allowPackages = true,
  isObjectiveReward = false,
  hideFields = [],
}: {
  form: UseFormReturn<any>;
  formData: FormEntry<any>[];
  type?: ContentType;
  allowPackages?: boolean;
  isObjectiveReward?: boolean;
  hideFields?: string[];
}) => {
  const { data: user } = useUserData();
  const {
    data: catalog,
    isError,
    isFetched,
    refetch,
  } = api.rewardPackages.getCatalog.useQuery(undefined, {
    enabled: isStaffRole(user?.role),
    // Nested editors reuse catalog errors; the Retry action controls recovery.
    retryOnMount: false,
  });
  const values = useWatch({ control: form.control });
  const [openedNodeIds, setOpenedNodeIds] = useState<string[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const packages = (values.reward_packages ?? []) as RewardPackageSnapshotType[];
  const defaultValues = ObjectiveReward.parse({});
  const customNodes = (catalog?.nodes ?? []).map((node) => ({
    ...node,
    fields: node.fields.filter((field) => !hideFields.includes(field)),
  }));
  // Custom groups replace standard field placement; uncovered fields keep their fallback group.
  const customFields = new Set(customNodes.flatMap((node) => node.fields));
  const groups = [
    ...(!isObjectiveReward && type === "quest"
      ? [
          {
            id: "milestone",
            name: "Elite Jonin Milestone",
            fields: ["reward_level", "reward_stats"],
          },
        ]
      : []),
    ...customNodes,
    ...DEFAULT_REWARD_NODES.map((node) => ({
      ...node,
      fields: node.fields.filter(
        (field) =>
          !customFields.has(field as keyof typeof rewardFields) &&
          !hideFields.includes(field),
      ),
    })),
  ].filter((node) => node.fields.length > 0);
  /** Detect populated fields against schema defaults so saved rewards reopen their groups. */
  const hasValue = (field: string) => {
    const value = values[field];
    return Array.isArray(value)
      ? value.length > 0
      : value !== undefined &&
          value !== defaultValues[field as keyof typeof defaultValues];
  };
  const activeNodes = getActiveRewardNodes(groups, openedNodeIds, hasValue);
  // Fallback groups are provisional until the custom catalog has loaded or failed.
  // isFetched persists through retries, keeping mounted controls and drafts intact.
  const isCatalogPending = !catalog && !isFetched && (!user || isStaffRole(user.role));
  // Remember inferred groups too: editing a value to zero must not remove or move its controls.
  useEffect(() => {
    if (isCatalogPending) return;
    const nextIds = activeNodes.map((node) => node.id);
    if (
      nextIds.length !== openedNodeIds.length ||
      nextIds.some((id, index) => id !== openedNodeIds[index])
    )
      setOpenedNodeIds(nextIds);
  }, [activeNodes, openedNodeIds, isCatalogPending]);
  /** Keep snapshot edits in the parent form's dirty state and validation lifecycle. */
  const setPackages = (next: RewardPackageSnapshotType[]) =>
    form.setValue("reward_packages", next, { shouldDirty: true, shouldValidate: true });
  /** Validate only the copied group's fields, leaving invalid drafts available for correction. */
  const copyNode = (node: (typeof groups)[number]) => {
    if (packages.length >= MAX_REWARD_PACKAGES) return;
    const rewards = ObjectiveReward.safeParse(
      Object.fromEntries(node.fields.map((field) => [field, values[field]])),
    );
    if (!rewards.success) {
      showFormErrorsToast(
        Object.fromEntries(
          rewards.error.issues.map((issue) => [
            issue.path.join("."),
            { type: issue.code, message: issue.message },
          ]),
        ),
      );
      return;
    }
    setPackages([
      ...packages,
      {
        id: nanoid(),
        name: node.name,
        description: "",
        rewards: rewards.data,
      },
    ]);
  };
  const source = catalog?.packages.find((pack) => pack.id === selectedPackage);
  if (isCatalogPending)
    return (
      <div className="col-span-full">
        <Loader explanation="Loading rewards" />
      </div>
    );
  return (
    <div className="col-span-full space-y-3 rounded-lg border p-3">
      <h3 className="font-bold">Rewards</h3>
      {isError && (
        <p role="alert">
          Could not load reward packages and nodes.{" "}
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </p>
      )}
      {allowPackages && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Reward package"
              className="min-w-0 flex-1 rounded border bg-background p-2"
              value={selectedPackage}
              onChange={(event) => setSelectedPackage(event.target.value)}
            >
              <option value="">Select a reward package</option>
              {catalog?.packages.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              disabled={!source || packages.length >= MAX_REWARD_PACKAGES}
              onClick={() => {
                // Each attachment owns its payload and identity; catalog edits cannot change it.
                if (source)
                  setPackages([
                    ...packages,
                    {
                      id: nanoid(),
                      packageId: source.id,
                      name: source.name,
                      description: source.description,
                      rewards: structuredClone(source.rewards),
                    },
                  ]);
              }}
            >
              Add Package
            </Button>
          </div>
          {source && <p className="text-sm">{getRewardPreview(source.rewards)}</p>}
          <p className="text-muted-foreground text-xs">
            Packages are editable copies. Later catalog edits do not change this quest.
            {isObjectiveReward
              ? " Objective packages are granted when this objective completes."
              : " Each package is one choice when the player chooses rewards."}
          </p>
          {packages.map((pack, index) => (
            <details key={pack.id} open className="rounded border p-2">
              <summary className="cursor-pointer font-semibold">
                {pack.name}: {getRewardPreview(pack.rewards)}
              </summary>
              <div className="my-2 flex flex-wrap gap-2">
                <Input
                  aria-label={
                    pack.packageId ? "Package snapshot name" : "Reward node name"
                  }
                  value={pack.name}
                  onChange={(event) =>
                    setPackages(
                      packages.map((entry, i) =>
                        i === index ? { ...entry, name: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={packages.length >= MAX_REWARD_PACKAGES}
                  onClick={() =>
                    setPackages([
                      ...packages,
                      { ...structuredClone(pack), id: nanoid() },
                    ])
                  }
                >
                  {pack.packageId ? "Add Another Package" : "Add Another Node"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPackages(packages.filter((_, i) => i !== index))}
                >
                  {pack.packageId ? "Remove Package" : "Remove Node"}
                </Button>
              </div>
              <RewardFormWrapper
                idx={0}
                reward={pack.rewards}
                rewards={[pack.rewards]}
                setRewards={(rewards) =>
                  setPackages(
                    packages.map((entry, i) =>
                      i === index
                        ? { ...entry, rewards: rewards[0] ?? ObjectiveReward.parse({}) }
                        : entry,
                    ),
                  )
                }
                grouped
                hideFields={hideFields}
              />
            </details>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Add reward node"
          className="min-w-0 flex-1 rounded border bg-background p-2"
          value=""
          onChange={(event) => {
            const node = groups.find((node) => node.id === event.target.value);
            if (!node) return;
            if (!activeNodes.some((active) => active.id === node.id)) {
              setOpenedNodeIds([...activeNodes.map((node) => node.id), node.id]);
              return;
            }
            copyNode(node);
          }}
        >
          <option value="">Add a reward node</option>
          {groups
            .filter(
              (node) =>
                (node.id !== "milestone" &&
                  allowPackages &&
                  packages.length < MAX_REWARD_PACKAGES) ||
                !activeNodes.some((active) => active.id === node.id),
            )
            .map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
                {activeNodes.some((active) => active.id === node.id)
                  ? " (another node)"
                  : ""}
              </option>
            ))}
        </select>
      </div>
      {activeNodes.map((node) => (
        <details key={node.id} open className="rounded border p-2">
          <summary className="cursor-pointer font-semibold">{node.name}</summary>
          <EditContent
            type={type}
            schema={QuestReward}
            form={form}
            formData={formData.filter((entry) => node.fields.includes(entry.id))}
            showSubmit={false}
            fieldsOnly
            allowMaterialRewards={!allowPackages}
          />
          {allowPackages && node.id !== "milestone" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={packages.length >= MAX_REWARD_PACKAGES}
              onClick={() => copyNode(node)}
            >
              Add Another Node
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              for (const field of node.fields.filter(
                (field) => !formData.find((entry) => entry.id === field)?.readonly,
              ))
                form.setValue(
                  field,
                  defaultValues[field as keyof typeof defaultValues],
                  { shouldDirty: true, shouldValidate: true },
                );
              setOpenedNodeIds(
                activeNodes
                  .filter((active) => active.id !== node.id)
                  .map((node) => node.id),
              );
            }}
          >
            Clear Node
          </Button>
        </details>
      ))}
    </div>
  );
};

/**
 * A wrapper component around EditContent for creating a form for reward fields
 * @returns React.ReactNode
 */
export const RewardFormWrapper: React.FC<RewardFormWrapperProps> = (props) => {
  const { idx, reward, rewards, setRewards, hideFields = [] } = props;

  const { data: rewardUser } = useUserData();
  // Parse reward with schema
  const parsedReward = ObjectiveReward.safeParse(reward);
  const shownReward = parsedReward.success ? parsedReward.data : reward;

  // Queries for db-backed fields
  const { data: itemData } = api.item.getAllNames.useQuery();
  const { data: jutsuData } = api.jutsu.getAllNames.useQuery();
  const { data: badgeData } = api.badge.getAll.useQuery();
  const { data: titleData } = api.title.getAllNames.useQuery();
  const { data: bloodlineData } = api.bloodline.getAllNames.useQuery();
  const { data: sageModeData } = api.sageMode.getAllNames.useQuery();

  // Form for handling the reward
  const form = useForm<any>({
    defaultValues: shownReward,
    values: shownReward,
    resolver: zodResolver(ObjectiveReward),
    mode: "all",
  });

  // Watch form values
  const watchAll = useWatch({ control: form.control });

  // Sync changed drafts; grouped editors include invalid values for parent validation.
  useEffect(() => {
    const newRewards = [...rewards];
    const parsed = ObjectiveReward.safeParse(watchAll);
    if (parsed.success || props.grouped) {
      newRewards[idx] = parsed.success
        ? parsed.data
        : (watchAll as ObjectiveRewardType);
      const diff = calculateContentDiff(rewards, newRewards);
      if (diff.length > 0) {
        setRewards(newRewards);
        // Keep invalid drafts without repeatedly resetting NaN values that diff as changed.
        if (parsed.success) form.reset(watchAll);
      }
    }
  }, [watchAll]);

  // Attributes on this reward schema
  type Attribute = keyof ObjectiveRewardType;
  const attributes = Object.keys(ObjectiveReward.shape) as Attribute[];

  // Generate form data dynamically
  const rewardCatalogs = {
    items: itemData,
    jutsus: jutsuData,
    bloodlines: bloodlineData,
    sageModes: sageModeData,
    titles: titleData,
    badges: badgeData?.data,
  };
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => !hideFields.includes(value))
    .map((value) => {
      const innerType = unwrapFieldSchema(ObjectiveReward.shape[value]);
      const rewardCatalogEntry = rewardCatalogFormEntry(value, rewardCatalogs);
      if (rewardCatalogEntry) return rewardCatalogEntry;

      // Special handling for db-backed array fields
      if (
        (value === "reward_hunter_items_ids" ||
          value === "reward_gathering_items_ids") &&
        itemData
      ) {
        return {
          id: value,
          values: itemData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values" as const,
        };
      } else if (innerType instanceof z.ZodNumber) {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "number" as const,
          readonly:
            value === "reward_reputation" &&
            !canAwardReputation(rewardUser?.role ?? "USER"),
        };
      } else if (innerType instanceof z.ZodBoolean) {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "boolean" as const,
        };
      } else if (innerType instanceof z.ZodEnum) {
        return {
          id: value,
          type: "str_array" as const,
          values: innerType.options as string[],
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "text" as const,
        };
      }
    });

  if (props.grouped)
    return (
      <RewardEditor
        form={form}
        formData={formData}
        allowPackages={false}
        hideFields={hideFields}
      />
    );
  return (
    <EditContent
      fieldsOnly
      schema={ObjectiveReward}
      form={form}
      formData={formData}
      showSubmit={false}
    />
  );
};

/** Fallback groups expose every reward field even when no custom catalog node includes it. */
const DEFAULT_REWARD_NODES = [
  { id: "give-title", name: "Give Title", fields: ["reward_titles"] },
  {
    id: "currency",
    name: "Currency",
    fields: ["reward_money", "reward_seichi_silver", "reward_reputation"],
  },
  {
    id: "organization",
    name: "Organization",
    fields: [
      "reward_clanpoints",
      "reward_anbupoints",
      "reward_tokens",
      "reward_prestige",
    ],
  },
  {
    id: "content",
    name: "Content",
    fields: [
      "reward_items",
      "reward_jutsus",
      "reward_bloodlines",
      "reward_sage_modes",
      "reward_badges",
    ],
  },
  {
    id: "progression",
    name: "Progression",
    fields: Object.keys(rewardFields).filter(
      (field) =>
        field.includes("experience") ||
        field === "reward_exp" ||
        field === "reward_skillpoints",
    ),
  },
  {
    id: "character",
    name: "Character",
    fields: [
      "reward_rank",
      "reward_village_membership",
      "reward_mastery_stat",
      "reward_mastery_rank",
    ],
  },
  {
    id: "special",
    name: "Materials & War",
    fields: [
      "reward_hunter_items",
      "reward_hunter_items_ids",
      "reward_gathering_items",
      "reward_gathering_items_ids",
      "reward_war_damage",
      "reward_war_healing",
    ],
  },
];

interface RewardFormWrapperProps {
  /** Use node groups for package payloads without recursively offering more packages. */
  grouped?: boolean;
  idx: number;
  reward: ObjectiveRewardType;
  rewards: ObjectiveRewardType[];
  setRewards: (rewards: ObjectiveRewardType[]) => void;
  hideFields?: string[];
}
