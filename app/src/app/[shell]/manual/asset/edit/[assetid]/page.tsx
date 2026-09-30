"use client";

import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { GameAsset } from "@/drizzle/schema";
import { useAssetEditForm } from "@/hooks/asset";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ZodGameAssetType } from "@/validators/asset";
import { gameAssetValidator } from "@/validators/asset";

export default function AssetEdit(props: { params: Promise<{ assetid: string }> }) {
  const params = use(props.params);
  const assetId = params.assetid;
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.gameAsset.get.useQuery(
    { id: assetId },
    { enabled: assetId !== undefined },
  );

  // Redirect to profile if not staff
  useEffect(() => {
    if (userData && !isStaffRole(userData.role)) {
      router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !isStaffRole(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return (
    <SingleEditAsset
      asset={data}
      refetch={refetch}
      canSave={canChangeContent(userData.role)}
    />
  );
}

interface SingleEditAssetProps {
  /** Staff who cannot save content still get the editor, to suggest changes. */
  canSave: boolean;
  asset: GameAsset;
  refetch: () => Promise<unknown>;
}

const SingleEditAsset: React.FC<SingleEditAssetProps> = (props) => {
  // Form handling
  const { asset, form, formData, handleAssetSubmit, isUpdating } = useAssetEditForm(
    props.asset,
    props.refetch,
  );

  // Show panel controls
  return (
    <ContentBox
      title="Content Panel"
      subtitle="Asset Management"
      defaultBackHref="/manual/asset"
      noRightAlign={true}
    >
      {!asset && <p>Could not find this asset</p>}
      {asset && (
        <>
          <EditContent
            schema={gameAssetValidator}
            form={form as unknown as UseFormReturn<ZodGameAssetType, unknown>}
            formData={formData}
            showSubmit={props.canSave}
            buttonTxt="Save to Database"
            submitLoading={isUpdating}
            submitLoadingText="Saving"
            type="asset"
            relationId={asset.id}
            allowImageUpload={props.canSave}
            onAccept={handleAssetSubmit}
          />
          <div className="mt-2 flex justify-end">
            <SuggestChange
              entityType="GAME_ASSET"
              entityId={asset.id}
              getData={() => form.getValues()}
              label={props.canSave ? "Suggest instead" : "Suggest a change"}
            />
          </div>
        </>
      )}
    </ContentBox>
  );
};
