import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { Badge } from "@/drizzle/schema";
import { useContentSubmit } from "@/hooks/contentSubmit";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import type { ZodBadgeType } from "@/validators/badge";
import { BadgeValidator } from "@/validators/badge";

/** Hook used when creating frontend forms for editing badges */
export const useBadgeEditForm = (badge: Badge, refetch: () => void) => {
  // Form handling
  const submitContent = useContentSubmit();
  const form = useForm<ZodBadgeType>({
    mode: "all",
    criteriaMode: "all",
    values: badge,
    defaultValues: badge,
    resetOptions: { keepDirtyValues: true },
    resolver: zodResolver(BadgeValidator),
  });

  // Mutation for updating badges
  const { mutateAsync: updateBadge, isPending: isUpdating } =
    api.badge.update.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) refetch();
      },
    });

  // Form submission
  const handleBadgeSubmit = form.handleSubmit(
    (data: ZodBadgeType) =>
      submitContent(badge, { ...badge, ...data }, (newBadge) =>
        updateBadge({ id: badge.id, data: newBadge }),
      ),
    (errors) => showFormErrorsToast(errors),
  );

  // Watch the badge image
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  // Object for form values
  const formData: FormEntry<keyof ZodBadgeType>[] = [
    { id: "name", label: "Badge Name", type: "text" },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "description", type: "text" },
  ];

  return { badge, form, formData, handleBadgeSubmit, isUpdating };
};
