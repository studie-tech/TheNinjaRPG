import { calculateContentDiff } from "@/utils/diff";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SkillTreeValidator } from "@/validators/combat";
import { api } from "@/app/_trpc/client";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import type { SkillTree } from "@/drizzle/schema";
import type { ZodAllTags, ZodSkillTreeType } from "@/validators/combat";
import { SkillTreeTargets, SkillTreeEntryTypes } from "@/drizzle/constants";
import type { FormEntry } from "@/layout/EditContent";

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
  const form = useForm<ZodSkillTreeType>({
    mode: "all",
    criteriaMode: "all",
    values: skillTree as ZodSkillTreeType,
    defaultValues: skillTree as ZodSkillTreeType,
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
  const loading = l1 || l2;

  // Watch for changes to avatar
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  // Get available prerequisite skills (lower tier than current)
  const allSkillsFlat = allSkills?.pages.flatMap((p) => p.data) ?? [];
  const availablePrereqSkills = allSkillsFlat.filter(
    (s) => s.id !== skillTree.id && s.tier < form.watch("tier"),
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
