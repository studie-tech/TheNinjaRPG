"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import React, { use, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import { EditContent, type FormEntry } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canModerateReskin } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type JutsuReskinUpdateSchema,
  jutsuReskinUpdateSchema,
} from "@/validators/jutsu";

export default function ReskinEdit(props: { params: Promise<{ reskinId: string }> }) {
  // State
  const params = use(props.params);
  const router = useRouter();
  const reskinId = params.reskinId;
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data: userData } = useRequiredUserData();

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

  // Redirect if not authorized
  React.useEffect(() => {
    if (userData && !canModerateReskin(userData.role)) {
      router.push("/manual/jutsu/reskins");
    }
  }, [userData, router]);

  // Prevent unauthorized access
  if (isPending || !userData || !canModerateReskin(userData.role) || !reskin) {
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
  const reskinData = reskin && !("success" in reskin) ? reskin : null;
  const formData: FormEntry<keyof JutsuReskinUpdateSchema>[] = [
    {
      id: "image",
      type: "avatar",
      label: "Image",
      href: reskinData?.image || undefined,
    },
    { id: "name", type: "text", label: "Reskin Name" },
    { id: "username", type: "text", label: "Owner (username)" },
    {
      id: "jutsuId",
      type: "db_values",
      label: "Base Jutsu",
      values: jutsuNames,
      searchable: true,
    },
    {
      id: "attached",
      type: "boolean",
      label: "Active on the owner's jutsu",
    },
    {
      id: "description",
      type: "richinput",
      label: "Custom Description",
    },
    {
      id: "battleDescription",
      type: "richinput",
      label: "Custom Battle Text",
    },
    {
      id: "reason",
      type: "richinput",
      label: "Reason for update",
      doubleWidth: true,
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
          relationId={reskinData?.id || reskinId}
          type="jutsu_reskin"
          onAccept={onAccept}
          submitDisabled={!form.formState.isValid || isUpdating}
        />
      </div>
    </ContentBox>
  );
}
