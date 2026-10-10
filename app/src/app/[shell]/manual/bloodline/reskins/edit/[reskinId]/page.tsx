"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { use, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ContentBox from "@/layout/ContentBox";
import { EditContent, type FormEntry } from "@/layout/EditContent";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent, canModerateReskin } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type BloodlineReskinUpdateSchema,
  bloodlineReskinUpdateSchema,
} from "@/validators/bloodline";
import {
  type CreateLinkedJutsuSchema,
  createLinkedJutsuSchema,
} from "@/validators/jutsu";

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
  const {
    data: reskin,
    isPending,
    isError,
    refetch,
  } = api.bloodline.getReskin.useQuery({ reskinId }, { enabled: !!reskinId });

  const [createError, setCreateError] = useState<string | null>(null);
  const createForm = useForm<CreateLinkedJutsuSchema>({
    mode: "all",
    resolver: zodResolver(createLinkedJutsuSchema),
    defaultValues: { parentId: "", bloodlineReskinId: reskinId },
  });
  const parentId = useWatch({ control: createForm.control, name: "parentId" });
  const reskinData = reskin && !("success" in reskin) ? reskin : null;
  const {
    data: parents,
    isError: parentsError,
    refetch: refetchParents,
  } = api.jutsu.getReskinParents.useQuery(undefined, { enabled: !!reskinData });
  const {
    data: linked,
    isError: linkedError,
    refetch: refetchLinked,
  } = api.jutsu.getLinkedReskins.useQuery({ id: reskinId });
  const { mutate: createLinked, isPending: isCreating } =
    api.jutsu.createLinkedReskin.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        setCreateError(data.success ? null : data.message);
        if (data.success) {
          await utils.jutsu.getLinkedReskins.invalidate({ id: reskinId });
          router.push(`/manual/jutsu/edit/${data.message}`);
        }
      },
      onError: (error) => setCreateError(error.message),
    });

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
    values: reskinData
      ? {
          name: reskinData.name,
          description: reskinData.description,
          image: reskinData.image,
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
  if (isPending || !userData || !canModerateReskin(userData.role)) {
    return <Loader explanation="Loading data" />;
  }

  if (!reskinData)
    return (
      <ContentBox title="Edit Bloodline Reskin">
        <p role="alert">
          {isError
            ? "Could not load this bloodline reskin."
            : "Bloodline reskin not found."}
        </p>
        <Button onClick={() => void refetch()}>Retry</Button>
      </ContentBox>
    );

  // Build EditContent config
  const formData: FormEntry<keyof BloodlineReskinUpdateSchema>[] = [
    {
      id: "image",
      type: "avatar",
      label: "Image",
      href: reskinData.image || undefined,
    },
    { id: "name", type: "text", label: "Reskin Name" },
    {
      id: "description",
      type: "richinput",
      label: "Custom Description",
    },
    {
      id: "reason",
      type: "richinput",
      label: "Reason for update",
      doubleWidth: true,
    },
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
              value={reskinData.bloodline?.name || ""}
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
            relationId={reskinData.id || reskinId}
            type="bloodline_reskin"
            onAccept={onAccept}
            submitDisabled={!form.formState.isValid || isUpdating}
          />
        </div>
      </ContentBox>
      <ContentBox
        title="Bloodline Jutsu Reskins"
        subtitle="Linked H-rank jutsu"
        initialBreak={true}
        topRightContent={
          canChangeContent(userData.role) && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="create-linked-jutsu-reskin"
                  aria-label="Create Jutsu Reskin"
                  disabled={!parents || parentsError || isCreating}
                >
                  <FilePlus className="h-6 w-6" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                {createError && (
                  <p role="alert" className="mb-4 text-destructive">
                    {createError}
                  </p>
                )}
                <EditContent
                  schema={createLinkedJutsuSchema}
                  form={createForm}
                  formData={[
                    {
                      id: "parentId",
                      label: "Parent Jutsu",
                      type: "db_values",
                      values: parents?.filter(
                        (j) => j.bloodlineId === reskinData.bloodlineId,
                      ),
                      searchable: true,
                      fullWidth: true,
                    },
                  ]}
                  showSubmit={true}
                  buttonTxt="Create Jutsu Reskin"
                  submitLoading={isCreating}
                  submitLoadingText="Creating..."
                  submitDisabled={!parentId}
                  onAccept={createForm.handleSubmit((data) => {
                    setCreateError(null);
                    createLinked(data);
                  })}
                />
              </PopoverContent>
            </Popover>
          )
        }
      >
        <p className="mb-4">
          Create a reskin from a jutsu belonging to the original bloodline. Parent edits
          automatically update its mechanics. New reskins start hidden; edit their
          cosmetics and publish them in the jutsu editor.
        </p>
        {parentsError && (
          <p role="alert">
            Could not load parent jutsu.{" "}
            <Button onClick={() => void refetchParents()}>Retry</Button>
          </p>
        )}
        {linkedError ? (
          <p role="alert">
            Could not load linked jutsu.{" "}
            <Button onClick={() => void refetchLinked()}>Retry</Button>
          </p>
        ) : linked ? (
          linked.length ? (
            linked.map((j) => <ItemWithEffects key={j.id} item={j} showEdit="jutsu" />)
          ) : (
            <p>No linked jutsu reskins yet.</p>
          )
        ) : (
          <Loader explanation="Loading linked jutsu" />
        )}
      </ContentBox>
    </>
  );
}
