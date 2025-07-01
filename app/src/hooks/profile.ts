import { calculateContentDiff } from "@/utils/diff";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/app/_trpc/client";
import { UserRanks } from "@/drizzle/constants";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import { updateUserSchema } from "@/validators/user";
import { canChangeUserRolesTo } from "@/utils/permissions";
import type { UpdateUserSchema } from "@/validators/user";
import type { FormEntry } from "@/layout/EditContent";

export interface EditUserPermissions {
  canEditUsername?: boolean;
  canEditCustomTitle?: boolean;
  canEditBloodline?: boolean;
  canEditVillage?: boolean;
  canEditRank?: boolean;
  canEditJutsus?: boolean;
  canEditItems?: boolean;
  canEditStaffAccountFlag?: boolean;
}

export const useUserEditForm = (
  userId: string,
  user: UpdateUserSchema,
  permissions?: EditUserPermissions,
) => {
  // Form handling
  const form = useForm<UpdateUserSchema>({
    mode: "all",
    criteriaMode: "all",
    values: user,
    defaultValues: user,
    resolver: zodResolver(updateUserSchema),
  });

  // Permissions with defaults set to true (backwards compatibility)
  const {
    canEditUsername = true,
    canEditCustomTitle = true,
    canEditBloodline = true,
    canEditVillage = true,
    canEditRank = true,
    canEditJutsus = true,
    canEditItems = true,
    canEditStaffAccountFlag = true,
  } = permissions || {};

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

  const availableRoles = user && canChangeUserRolesTo(user.role);

  // Build formData based on permissions
  const formData: FormEntry<keyof UpdateUserSchema>[] = [];

  if (canEditUsername) {
    formData.push({ id: "username", type: "text" });
  }
  if (canEditCustomTitle) {
    formData.push({ id: "customTitle", type: "text" });
  }
  if (availableRoles && availableRoles.length > 0)
    formData.push({ id: "role", type: "str_array", values: availableRoles });
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
  if (canEditVillage)
    formData.push({
      id: "villageId",
      type: "db_values",
      values: villages || [],
      resetButton: true,
    });
  if (canEditStaffAccountFlag)
    formData.push({ id: "staffAccount", type: "boolean", label: "Staff Benefits" });

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
