import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { SkillTreeEntryTypes, SkillTreeTargets } from "@/drizzle/constants";
import type { SkillTree } from "@/drizzle/schema";
import { useContentSubmit } from "@/hooks/contentSubmit";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { canAccessHiddenSkillTree } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import type {
  ZodAllTags,
  ZodSkillTreeInput,
  ZodSkillTreeType,
} from "@/validators/combat";
import { SkillTreeValidator } from "@/validators/combat";

/**
 * Hook used when creating frontend forms for editing skills
 * @param data
 */
export const useSkillTreeEditForm = (data: SkillTree, refetch: () => void) => {
  // Get utils
  const utils = api.useUtils();
  const { data: userData } = useRequiredUserData();

  const skillTree = { ...data };

  // Form handling
  const submitContent = useContentSubmit();
  const form = useForm<ZodSkillTreeInput, unknown, ZodSkillTreeType>({
    mode: "all",
    criteriaMode: "all",
    values: skillTree as ZodSkillTreeInput,
    defaultValues: skillTree as ZodSkillTreeInput,
    resolver: zodResolver(SkillTreeValidator),
  });

  const watchedBloodlineId = useWatch({ control: form.control, name: "bloodlineId" });
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery();

  // Query for all skills for prerequisite selection
  const { data: allSkills, isPending: l1 } = api.skillTree.getAll.useInfiniteQuery(
    { limit: 500, hidden: undefined, pathType: data.pathType },
    {
      refetchOnWindowFocus: false,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );

  // Query for all folders for folder selection
  const { data: allFolders, isPending: l3 } = api.skillTree.getAllFolders.useQuery(
    { includeHidden: true },
    { refetchOnWindowFocus: false },
  );

  // Mutation for updating skill
  const { mutateAsync: updateSkillTree, isPending: l2 } =
    api.skillTree.update.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          refetch();
          void utils.skillTree.getAll.invalidate();
        }
      },
    });

  // Form submission
  const handleSkillTreeSubmit = form.handleSubmit(
    (data: ZodSkillTreeType) =>
      submitContent(skillTree, { ...skillTree, ...data }, (newSkillTree) =>
        updateSkillTree({ id: skillTree.id, data: newSkillTree }),
      ),
    (errors) => showFormErrorsToast(errors),
  );

  // Watch the effects
  const effects = useWatch({
    control: form.control,
    name: "effects",
  });

  // Handle updating of effects
  const setEffects = (newEffects: ZodAllTags[]) => {
    form.setValue("effects", newEffects, { shouldDirty: true });
  };

  // Are we loading data
  const loading = l1 || l2 || l3;

  // Watch for changes to avatar
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  const watchedTier = useWatch({
    control: form.control,
    name: "tier",
  });

  // Get available prerequisite skills (lower tier than current)
  const allSkillsFlat = allSkills?.pages.flatMap((p) => p.data) ?? [];
  const availablePrereqSkills = allSkillsFlat.filter(
    (s) =>
      s.id !== skillTree.id &&
      s.tier < (watchedTier as number) &&
      s.bloodlineId === (watchedBloodlineId || null),
  );

  // Object for form values
  const formData: FormEntry<keyof ZodSkillTreeType>[] = [
    { id: "name", type: "text" },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "target", type: "str_array", values: SkillTreeTargets },
    { id: "tier", type: "number" },
    ...(data.pathType === "BLOODRIGHT"
      ? [
          {
            id: "bloodlineId" as const,
            type: "db_values" as const,
            values: bloodlines ?? [],
            label: "Bloodline (required)",
          },
          {
            id: "seichiSilverCost" as const,
            type: "number" as const,
            label: "Seichi Silver Cost",
          },
        ]
      : [
          {
            id: "costSkillPoints" as const,
            type: "number" as const,
            label: "Skill Points Cost",
          },
        ]),
    ...(canAccessHiddenSkillTree(userData?.role)
      ? [{ id: "hidden" as const, type: "boolean" as const }]
      : []),
    ...(data.pathType === "SKILL"
      ? [
          {
            id: "skillType" as const,
            type: "str_array" as const,
            values: SkillTreeEntryTypes,
          },
        ]
      : []),
    {
      id: "folderId",
      type: "db_values",
      values: allFolders?.map((f) => ({ id: f.id, name: f.name })) || [],
      label: "Folder",
      multiple: false,
    },
    { id: "description", type: "richinput", doubleWidth: true },
    {
      id: "requiredSkillIds",
      type: "db_values",
      values:
        availablePrereqSkills?.map((skill) => ({
          id: skill.id,
          name: `Tier ${skill.tier}: ${skill.name}`,
        })) || [],
      label: "Prerequisites",
      multiple: true,
      doubleWidth: true,
    },
  ];

  return {
    skillTree,
    effects,
    form,
    formData,
    loading,
    setEffects,
    handleSkillTreeSubmit,
  };
};
