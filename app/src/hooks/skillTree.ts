import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { SkillTreeEntryTypes, SkillTreeTargets } from "@/drizzle/constants";
import type { SkillTree } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
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

  // Case type
  const skillTree = { ...data, effects: data.effects };

  // Form handling
  const form = useForm<ZodSkillTreeInput, unknown, ZodSkillTreeType>({
    mode: "all",
    criteriaMode: "all",
    values: skillTree as ZodSkillTreeInput,
    defaultValues: skillTree as ZodSkillTreeInput,
    resolver: zodResolver(SkillTreeValidator),
  });

  // Query for all skills for prerequisite selection
  const { data: allSkills, isPending: l1 } = api.skillTree.getAll.useInfiniteQuery(
    { limit: 500, hidden: undefined },
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
  const { mutate: updateSkillTree, isPending: l2 } = api.skillTree.update.useMutation({
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
    (data: ZodSkillTreeType) => {
      const newSkillTree = { ...skillTree, ...data };
      const diff = calculateContentDiff(skillTree, newSkillTree);
      if (diff.length > 0) {
        updateSkillTree({ id: skillTree.id, data: newSkillTree });
      }
    },
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

  // Get available prerequisite skills (lower tier than current)
  const allSkillsFlat = allSkills?.pages.flatMap((p) => p.data) ?? [];
  const availablePrereqSkills = allSkillsFlat.filter(
    (s) => s.id !== skillTree.id && s.tier < (form.watch("tier") as number),
  );

  // Object for form values
  const formData: FormEntry<keyof ZodSkillTreeType>[] = [
    { id: "name", type: "text" },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "target", type: "str_array", values: SkillTreeTargets },
    { id: "tier", type: "number" },
    { id: "costSkillPoints", type: "number", label: "Skill Points Cost" },
    { id: "hidden", type: "boolean" },
    { id: "skillType", type: "str_array", values: SkillTreeEntryTypes },
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
