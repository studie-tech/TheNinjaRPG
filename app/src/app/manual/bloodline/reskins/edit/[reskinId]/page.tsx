"use client";

import React, { use } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { EditContent, type FormEntry } from "@/layout/EditContent";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canModerateReskin } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  bloodlineReskinUpdateSchema,
  type BloodlineReskinUpdateSchema,
} from "@/validators/bloodline";

export default function BloodlineReskinEdit(props: {
  params: Promise<{ reskinId: string }>;
}) {
  const { reskinId } = use(props.params);
  return <SingleEditBloodlineReskin reskinId={reskinId} />;
}

function SingleEditBloodlineReskin({ reskinId }: { reskinId: string }) {
  const router = useRouter();
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  // Queries
  const { data: reskin, isPending } = api.bloodline.getReskin.useQuery(
    { reskinId },
    { enabled: !!reskinId },
  );

  // Form handling
  const form = useForm<BloodlineReskinUpdateSchema>({
    mode: "all",
    criteriaMode: "all",
    resolver: zodResolver(bloodlineReskinUpdateSchema),
    defaultValues: {
      name: "",
      description: "",
      image: undefined,
      reason: "",
    },
    values:
      reskin && !("success" in reskin)
        ? {
            name: reskin.name,
            description: reskin.description,
            image: reskin.image,
            reason: "",
          }
        : undefined,
  });

  // Mutation for updating reskin
  const { mutate: updateReskin, isPending: isUpdating } =
    api.bloodline.updateReskin.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.bloodline.getReskin.invalidate({ reskinId });
        }
      },
    });

  // Redirect if not authorized
  React.useEffect(() => {
    if (userData && !canModerateReskin(userData.role)) {
      router.push("/manual/bloodline/reskins");
    }
  }, [userData, router]);

  // Prevent unauthorized access
  if (isPending || !userData || !canModerateReskin(userData.role) || !reskin) {
    return <Loader explanation="Loading data" />;
  }

  // Build EditContent config
  const reskinData = reskin && !("success" in reskin) ? reskin : null;
  const formData: FormEntry<keyof BloodlineReskinUpdateSchema>[] = [
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
    { id: "reason", type: "richinput", label: "Reason for update", doubleWidth: true },
  ];

  const onAccept = async () => {
    const data = form.getValues();
    updateReskin({ reskinId, data });
  };

  return (
    <>
      <ContentBox
        title="Edit Bloodline Reskin"
        subtitle="Modify reskin information"
        defaultBackHref="/manual/bloodline/reskins"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="original-bloodline">Original Bloodline</Label>
            <Input
              id="original-bloodline"
              value={
                reskin && !("success" in reskin) ? reskin.bloodline?.name || "" : ""
              }
              disabled
              className="mt-1"
            />
          </div>

          <EditContent
            schema={bloodlineReskinUpdateSchema}
            form={form}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save Changes"
            allowImageUpload={true}
            relationId={reskinData?.id || reskinId}
            type="bloodline_reskin"
            onAccept={onAccept}
            submitDisabled={!form.formState.isValid || isUpdating}
          />
        </div>
      </ContentBox>
    </>
  );
}
