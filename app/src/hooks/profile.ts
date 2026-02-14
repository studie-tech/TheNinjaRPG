import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { UserRole } from "@/drizzle/constants";
import { UserRanks } from "@/drizzle/constants";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import type { UpdateUserInput, UpdateUserSchema } from "@/validators/user";
import { updateUserSchema } from "@/validators/user";

export interface EditUserPermissions {
  canEditUsername?: boolean;
  canEditCustomTitle?: boolean;
  canEditBloodline?: boolean;
  canEditVillage?: boolean;
  canEditRank?: boolean;
  canEditJutsus?: boolean;
  canEditItems?: boolean;
  canEditStaffAccountFlag?: boolean;
  canEditUserRoles?: UserRole[];
  canEditRankedLp?: boolean;
}

export const useUserEditForm = (
  userId: string,
  user: UpdateUserSchema,
  permissions: EditUserPermissions,
) => {
  // Form handling
  const form = useForm<UpdateUserInput, unknown, UpdateUserSchema>({
    mode: "all",
    criteriaMode: "all",
    values: user as UpdateUserInput,
    defaultValues: user as UpdateUserInput,
    resolver: zodResolver(updateUserSchema),
  });

  // Permissions with defaults set to false
  const {
    canEditUsername = false,
    canEditCustomTitle = false,
    canEditBloodline = false,
    canEditVillage = false,
    canEditRank = false,
    canEditJutsus = false,
    canEditItems = false,
    canEditStaffAccountFlag = false,
    canEditUserRoles = [],
    canEditRankedLp = false,
  } = permissions;

  // Conditional queries based on permissions
  const { data: jutsus, isPending: l1 } = api.jutsu.getAllNames.useQuery(undefined, {
    enabled: canEditJutsus,
  });
  const { data: items, isPending: l2 } = api.item.getAllNames.useQuery(undefined, {
    enabled: canEditItems,
  });
  const { data: lines, isPending: l3 } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: canEditBloodline,
  });
  const selectedBloodlineId = useWatch({ control: form.control, name: "bloodlineId" });
  const { data: lineReskins } = api.bloodline.getReskinsForBloodline.useQuery(
    { bloodlineId: selectedBloodlineId || "" },
    { enabled: canEditBloodline && !!selectedBloodlineId },
  );
  const { data: villages, isPending: l5 } = api.village.getAllNames.useQuery(
    undefined,
    { enabled: canEditVillage },
  );
  const { data: userJutsus, isPending: l6 } = api.jutsu.getPublicUserJutsus.useQuery(
    { userId: userId },
    { enabled: canEditJutsus },
  );

  // tRPC utility
  const utils = api.useUtils();

  // Update jutsus with level
  const jutsusWithNames = jutsus?.map((jutsu) => {
    const userjutsu = userJutsus?.find((uj) => uj.jutsuId === jutsu.id);
    return userjutsu ? { ...jutsu, name: `${jutsu.name} (${userjutsu.level})` } : jutsu;
  });

  // Mutation for updating item
  const { mutate: updateUser, isPending: l4 } = api.profile.updateUser.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      void utils.profile.getPublicUser.invalidate();
      void utils.jutsu.getPublicUserJutsus.invalidate();
    },
  });

  // Form submission
  const handleUserSubmit = form.handleSubmit(
    (data) => {
      const diff = calculateContentDiff(user, data);
      if (diff.length > 0) {
        updateUser({ id: userId, data: data });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Build formData based on permissions
  const formData: FormEntry<keyof UpdateUserSchema>[] = [];

  if (canEditUsername) {
    formData.push({ id: "username", type: "text" });
  }
  if (canEditCustomTitle) {
    formData.push({ id: "customTitle", type: "text" });
  }
  if (canEditUserRoles && canEditUserRoles.length > 0)
    formData.push({ id: "role", type: "str_array", values: canEditUserRoles });
  if (canEditRank) {
    formData.push({ id: "rank", type: "str_array", values: UserRanks });
  }
  if (canEditBloodline)
    formData.push({
      id: "bloodlineId",
      type: "db_values",
      values: lines || [],
      resetButton: true,
    });
  if (canEditBloodline)
    formData.push({
      id: "bloodlineReskinId",
      type: "db_values",
      values:
        [{ id: "", name: "None", image: "" }].concat(
          (lineReskins ?? []).map((r) => ({ id: r.id, name: r.name, image: r.image })),
        ) || [],
      label: "Bloodline Reskin",
      resetButton: true,
    });
  if (canEditVillage)
    formData.push({
      id: "villageId",
      type: "db_values",
      values: villages || [],
      resetButton: true,
    });
  if (canEditStaffAccountFlag)
    formData.push({ id: "staffAccount", type: "boolean", label: "Staff Benefits" });

  if (canEditRankedLp)
    formData.push({ id: "rankedLp", type: "number", label: "Ranked LP" });

  if (canEditJutsus)
    formData.push({
      id: "jutsus",
      type: "db_values",
      values: jutsusWithNames || [],
      multiple: true,
      doubleWidth: true,
    });
  if (canEditItems)
    formData.push({
      id: "items",
      type: "db_values",
      values: items || [],
      multiple: true,
      doubleWidth: true,
    });
  formData.push({ id: "reason", type: "richinput", doubleWidth: true });

  // Determine if any of the queries we actually executed are loading
  const loading =
    l4 ||
    (canEditJutsus ? l1 : false) ||
    (canEditItems ? l2 : false) ||
    (canEditBloodline ? l3 : false) ||
    (canEditVillage ? l5 : false) ||
    (canEditJutsus ? l6 : false);

  return { user, loading, form, formData, userJutsus, handleUserSubmit };
};
