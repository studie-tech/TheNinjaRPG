import { calculateContentDiff } from "@/utils/diff";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/app/_trpc/client";
import { ElementNames, UserRanks, GeneralTypes, StatTypes } from "@/drizzle/constants";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import { insertAiSchema } from "@/drizzle/schema";
import type { InsertAiSchema } from "@/drizzle/schema";
import type { UserData } from "@/drizzle/schema";
import type { UserJutsu } from "@/drizzle/schema";
import type { UserItem } from "@/drizzle/schema";
import type { ZodAllTags } from "@/libs/combat/types";
import type { FormEntry } from "@/layout/EditContent";

/**
 * Hook used when creating frontend forms for editing AIs
 * @param data
 */
export const useAiEditForm = (
  user: UserData & { jutsus: UserJutsu[]; items: UserItem[] },
) => {
  // Process data for form
  const processedUser = {
    ...user,
    jutsus: user?.jutsus?.map((jutsu) => jutsu.jutsuId),
    items: user?.items?.map((item) => item.itemId),
  };

  // Form handling
  const form = useForm<InsertAiSchema>({
    mode: "all",
    criteriaMode: "all",
    values: processedUser,
    defaultValues: processedUser,
    resolver: zodResolver(insertAiSchema),
  });

  // Query for content
  const { data: jutsus, isPending: l1 } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: items, isPending: l2 } = api.item.getAllNames.useQuery(undefined);
  const { data: lines, isPending: l3 } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: clans, isPending: l5 } = api.clan.getAllNames.useQuery(undefined);
  const { data: anbus, isPending: l6 } = api.anbu.getAllNames.useQuery(undefined);

  // tRPC utility
  const utils = api.useUtils();

  // Mutation for updating item
  const { mutate: updateAi, isPending: l4 } = api.profile.updateAi.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await utils.profile.getAi.invalidate();
    },
  });

  // Form submission
  const handleUserSubmit = form.handleSubmit(
    (data) => {
      const diff = calculateContentDiff(user, data);
      if (diff.length > 0) {
        updateAi({ id: user.userId, data: data });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Watch for changes to avatar
  const avatarUrl = useWatch({
    control: form.control,
    name: "avatar",
    defaultValue: user.avatar,
  });
  const avatar3dUrl = useWatch({
    control: form.control,
    name: "avatar3d",
    defaultValue: user.avatar3d,
  });
  const effects = useWatch({
    control: form.control,
    name: "effects",
    defaultValue: user.effects,
  });

  // Handle updating of effects
  const setEffects = (newEffects: ZodAllTags[]) => {
    form.setValue("effects", newEffects, { shouldDirty: true });
  };

  // Are we loading data
  const loading = l1 || l2 || l3 || l4 || l5 || l6;

  // Object for form values
  const formData: FormEntry<keyof InsertAiSchema | "jutsus" | "items">[] = [
    { id: "username", type: "text" },
    { id: "customTitle", type: "text" },
    { id: "avatar", type: "avatar", href: avatarUrl },
    { id: "avatar3d", type: "avatar3d", modelUrl: avatar3dUrl, imgUrl: avatarUrl },
    { id: "gender", type: "text" },
    { id: "level", type: "number" },
    { id: "regeneration", type: "number" },
    { id: "rank", type: "str_array", values: UserRanks },
    {
      id: "bloodlineId",
      type: "db_values",
      values: lines,
      resetButton: true,
    },
    { id: "ninjutsuOffence", label: "Nin Off Focus", type: "number" },
    { id: "ninjutsuDefence", label: "Nin Def Focus", type: "number" },
    { id: "genjutsuOffence", label: "Gen Off Focus", type: "number" },
    { id: "genjutsuDefence", label: "Gen Def Focus", type: "number" },
    { id: "taijutsuOffence", label: "Tai Off Focus", type: "number" },
    { id: "taijutsuDefence", label: "Tai Def Focus", type: "number" },
    { id: "bukijutsuOffence", label: "Buku Off Focus", type: "number" },
    { id: "bukijutsuDefence", label: "Buki Def Focus", type: "number" },
    { id: "statsMultiplier", type: "number", label: "Stat Multiplier [Go beyond cap]" },
    { id: "poolsMultiplier", type: "number", label: "Pool Modifier [Go beyond cap]" },
    { id: "strength", label: "Strength Focus", type: "number" },
    { id: "intelligence", label: "Intelligence Focus", type: "number" },
    { id: "willpower", label: "Willpower Focus", type: "number" },
    { id: "speed", label: "Speed Focus", type: "number" },
    { id: "isSummon", type: "boolean" },
    { id: "inArena", type: "boolean" },
    { id: "inShrines", type: "boolean" },
    {
      id: "primaryElement",
      type: "str_array",
      values: ElementNames,
      resetButton: true,
    },
    {
      id: "secondaryElement",
      type: "str_array",
      values: ElementNames,
      resetButton: true,
    },
    {
      id: "preferredStat",
      type: "str_array",
      values: StatTypes,
      resetButton: true,
    },
    {
      id: "preferredGeneral1",
      type: "str_array",
      values: GeneralTypes,
      resetButton: true,
    },
    {
      id: "preferredGeneral2",
      type: "str_array",
      values: GeneralTypes,
      resetButton: true,
    },
    {
      id: "anbuId",
      label: "Anbu Squad",
      type: "db_values",
      values: anbus,
    },
    {
      id: "clanId",
      label: "Clan",
      type: "db_values",
      values: clans,
    },
    {
      id: "jutsus",
      type: "db_values",
      values: jutsus,
      multiple: true,
      doubleWidth: true,
    },
    {
      id: "items",
      type: "db_values",
      values: items,
      multiple: true,
      doubleWidth: true,
    },
  ];

  return {
    processedUser,
    effects,
    loading,
    form,
    formData,
    setEffects,
    handleUserSubmit,
  };
};
