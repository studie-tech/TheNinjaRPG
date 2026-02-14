"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import React, { use } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const { data: userData } = useRequiredUserData();

  // tRPC utils
  const utils = api.useUtils();

  // Queries
  const { data: reskin, isPending } = api.jutsu.getReskin.useQuery(
    { reskinId },
    { enabled: !!reskinId },
  );

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
      reason: "",
    },
    values:
      reskin && !("success" in reskin)
        ? {
            name: reskin.name,
            description: reskin.description,
            battleDescription: reskin.battleDescription,
            image: reskin.image,
            reason: "",
          }
        : undefined,
  });

  // Mutation for updating reskin
  const { mutate: updateReskin, isPending: isUpdating } =
    api.jutsu.updateReskin.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.jutsu.getReskin.invalidate({ reskinId });
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
    console.log("onAccept");
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
        <div>
          <Label htmlFor="original-jutsu">Original Jutsu</Label>
          <Input
            id="original-jutsu"
            value={reskin && !("success" in reskin) ? reskin.jutsu.name : ""}
            disabled
            className="mt-1"
          />
        </div>

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
