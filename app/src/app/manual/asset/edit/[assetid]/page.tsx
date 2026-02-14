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
import { canChangeContent } from "@/utils/permissions";
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

  // Redirect to profile if not content or admin
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditAsset asset={data} refetch={refetch} />;
}

interface SingleEditAssetProps {
  asset: GameAsset;
  refetch: () => void;
}

const SingleEditAsset: React.FC<SingleEditAssetProps> = (props) => {
  // Form handling
  const { asset, form, formData, handleAssetSubmit } = useAssetEditForm(
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
        <EditContent
          schema={gameAssetValidator}
          form={form as unknown as UseFormReturn<ZodGameAssetType, unknown>}
          formData={formData}
          showSubmit={true}
          buttonTxt="Save to Database"
          type="asset"
          relationId={asset.id}
          allowImageUpload={true}
          onAccept={handleAssetSubmit}
        />
      )}
    </ContentBox>
  );
};
