"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { use, useRef } from "react";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { MapAsset } from "@/drizzle/schema";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { EditContent, type FormEntry } from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import Loader from "@/layout/Loader";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import {
  mapAssetValidator,
  type ZodMapAssetType,
  type ZodMapAssetTypeInput,
} from "@/validators/mapAsset";

/** Content-staff edit page for a single map asset: redirects non-editors to /profile, then delegates to SingleEditMapAsset */
export default function MapAssetEdit(props: { params: Promise<{ assetid: string }> }) {
  const params = use(props.params);
  const assetId = params.assetid;
  const { userData, hasAccess } = useRequireRole(canChangeContent);

  const { data, isPending, isError, isFetching, refetch } = api.mapAsset.get.useQuery(
    { id: assetId },
    { enabled: !!assetId && !!userData },
  );

  if (isPending || !userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }
  if (!data) {
    return (
      <EditorQueryFeedback
        label="map asset"
        subtitle="Map Asset Management"
        backHref="/manual/world/tilesets"
        isError={isError}
        isFetching={isFetching}
        onRetry={refetch}
      />
    );
  }

  return <SingleEditMapAsset asset={data} refetch={refetch} />;
}

interface SingleEditMapAssetProps {
  // Public get() omits the internal authoring user-id, which this form ignores
  asset: Omit<MapAsset, "createdByUserId">;
  refetch: () => void;
}

/**
 * Form for a single decoration asset. Submit diffs against the loaded asset
 * (calculateContentDiff) and only mutates when something changed; renaming
 * the asset key orphans decorations on maps that reference it.
 */
const SingleEditMapAsset: React.FC<SingleEditMapAssetProps> = (props) => {
  const { asset, refetch } = props;
  const utils = api.useUtils();
  const submitInFlight = useRef(false);
  const form = useForm<ZodMapAssetTypeInput, unknown, ZodMapAssetType>({
    mode: "all",
    criteriaMode: "all",
    values: asset,
    defaultValues: asset,
    resolver: zodResolver(mapAssetValidator),
  });

  const { mutate: updateAsset, isPending: isUpdating } =
    api.mapAsset.update.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (!data.success) return;
        await refetch();
        // The tilesets list and the travel page session-cache the full library
        // (getAll), so a save here must invalidate it or they keep showing the
        // old sprite until a manual refresh
        await utils.mapAsset.getAll.invalidate();
      },
      onSettled: () => {
        submitInFlight.current = false;
      },
    });

  const handleAssetSubmit = form.handleSubmit(
    (data: ZodMapAssetType) => {
      if (submitInFlight.current) return;
      const newAsset = { ...asset, ...data };
      const diff = calculateContentDiff(asset, newAsset);
      if (diff.length > 0) {
        submitInFlight.current = true;
        updateAsset({ id: asset.id, data: newAsset });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  const category = useWatch({ control: form.control, name: "category" });
  const imageUrl = useWatch({ control: form.control, name: "imageUrl" });
  const entryName = useWatch({ control: form.control, name: "name" });
  const heading = useEditorTitle("map asset", entryName);

  const formData: FormEntry<keyof ZodMapAssetType>[] = [
    { id: "name", label: "Display Name", type: "text" },
    {
      id: "imageUrl",
      label: "Sprite (transparent PNG)",
      type: "avatar",
      href: imageUrl,
      // Buildings need more detail than small terrain decorations.
      maxDim: category === "structure" ? 512 : 75,
    },
    { id: "key", label: "Asset Key (used by maps)", type: "text" },
    { id: "category", label: "Category", type: "text" },
    { id: "windAffected", label: "Sways in the wind", type: "boolean" },
    { id: "small", label: "Small object (hidable)", type: "boolean" },
    { id: "randomRotation", label: "Random rotation", type: "boolean" },
    { id: "renderScale", label: "Default size (x hex height)", type: "number" },
    { id: "licenseDetails", label: "License / attribution", type: "text" },
  ];

  return (
    <ContentBox
      title={heading}
      subtitle="Map Asset Management"
      defaultBackHref="/manual/world/tilesets"
      noRightAlign={true}
    >
      <p className="pb-3 text-muted-foreground text-sm">
        The asset key is how maps reference this sprite: renaming the key orphans
        decorations that use it. Keys are lowercase dot-separated, e.g.
        tree.green.round.
      </p>
      <EditContent
        schema={mapAssetValidator}
        form={form as UseFormReturn<ZodMapAssetType>}
        formData={formData}
        showSubmit={true}
        buttonTxt="Save to Database"
        submitLoading={isUpdating}
        submitLoadingText="Saving"
        type="mapAsset"
        relationId={asset.id}
        allowImageUpload={true}
        onAccept={handleAssetSubmit}
      />
    </ContentBox>
  );
};
