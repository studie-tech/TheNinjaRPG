"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { use, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { EditContent, type FormEntry } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canModerateReskin } from "@/utils/permissions";
import {
  type JutsuReskinUpdateSchema,
  jutsuReskinUpdateSchema,
} from "@/validators/jutsu";

export default function ReskinEdit(props: { params: Promise<{ reskinId: string }> }) {
  // State
  const params = use(props.params);
  const reskinId = params.reskinId;
  const [saveError, setSaveError] = useState<string | null>(null);
  const { userData, hasAccess } = useRequireRole(
    canModerateReskin,
    "/manual/jutsu/reskins",
  );

  // tRPC utils
  const utils = api.useUtils();

  // Queries
  const { data: reskin, isPending } = api.jutsu.getReskin.useQuery(
    { reskinId },
    { enabled: !!reskinId },
  );
  const { data: jutsuNames } = api.jutsu.getAllNames.useQuery();

  // Form handling
  const form = useForm<JutsuReskinUpdateSchema>({
    mode: "all",
    criteriaMode: "all",
    resolver: zodResolver(jutsuReskinUpdateSchema),
    defaultValues: {
      name: "",
      description: "",
      battleDescription: "",
      image: undefined,
      username: "",
      jutsuId: "",
      attached: false,
      reason: "",
    },
    values:
      reskin && !("success" in reskin)
        ? {
            name: reskin.name,
            description: reskin.description,
            battleDescription: reskin.battleDescription,
            image: reskin.image,
            username: reskin.user?.username ?? "",
            jutsuId: reskin.jutsuId,
            attached: reskin.attached,
            reason: "",
          }
        : undefined,
  });

  const reason = useWatch({ control: form.control, name: "reason" }) ?? "";

  // Mutation for updating reskin
  const { mutate: updateReskin, isPending: isUpdating } =
    api.jutsu.updateReskin.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        setSaveError(data.success ? null : data.message);
        if (data.success) {
          await Promise.all([
            utils.jutsu.getReskin.invalidate({ reskinId }),
            utils.jutsu.getAllReskins.invalidate(),
          ]);
        }
      },
    });

  // Prevent unauthorized access
  if (isPending || !userData || !hasAccess || !reskin) {
    return <Loader explanation="Loading data" />;
  }

  if ("success" in reskin) {
    return (
      <ContentBox title="Edit Jutsu Reskin" defaultBackHref="/manual/jutsu/reskins">
        <p role="alert">{reskin.message}</p>
      </ContentBox>
    );
  }

  // Build EditContent config
  const formData: FormEntry<keyof JutsuReskinUpdateSchema>[] = [
    {
      id: "image",
      section: "Reskin",
      type: "avatar",
      label: "Image",
      href: reskin.image || undefined,
    },
    { id: "name", type: "text", label: "Reskin Name", section: "Reskin" },
    { id: "username", type: "text", label: "Owner (username)", section: "Reskin" },
    {
      id: "jutsuId",
      section: "Reskin",
      type: "db_values",
      label: "Base Jutsu",
      values: jutsuNames,
      searchable: true,
    },
    {
      id: "attached",
      section: "Reskin",
      type: "boolean",
      label: "Active on the owner's jutsu",
    },
    {
      id: "description",
      section: "Reskin",
      type: "richinput",
      label: "Custom Description",
      doubleWidth: true,
    },
    {
      id: "battleDescription",
      section: "Reskin",
      type: "richinput",
      label: "Custom Battle Text",
      doubleWidth: true,
    },
    {
      id: "reason",
      type: "textarea",
      label: "Reason for update",
      doubleWidth: true,
      section: "Audit",
    },
  ];

  const onAccept = async () => {
    setSaveError(null);
    const data = form.getValues();
    updateReskin({ reskinId, data });
  };

  return (
    <ContentBox
      title="Edit Jutsu Reskin"
      subtitle="Modify reskin information"
      defaultBackHref="/manual/jutsu/reskins"
    >
      <div className="space-y-4">
        {saveError && (
          <p role="alert" className="text-destructive">
            {saveError}
          </p>
        )}
        <EditContent
          schema={jutsuReskinUpdateSchema}
          form={form}
          formData={formData}
          showSubmit={true}
          buttonTxt="Save Changes"
          allowImageUpload={true}
          relationId={reskin.id}
          type="jutsu_reskin"
          onAccept={onAccept}
          submitDisabled={!form.formState.isValid || isUpdating}
        >
          {reason.length < REASON_MIN_LENGTH && (
            <p className="col-span-full px-2 text-muted-foreground text-sm">
              Add a reason (at least {REASON_MIN_LENGTH} characters) to save.
            </p>
          )}
        </EditContent>
      </div>
    </ContentBox>
  );
}

/** Shortest reason the update schema accepts, shown while Save is disabled. */
const REASON_MIN_LENGTH = jutsuReskinUpdateSchema.shape.reason.minLength ?? 0;
