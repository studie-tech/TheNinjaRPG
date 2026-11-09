"use client";

import { use } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { TowerDefenseUpgrade } from "@/drizzle/schema";
import { useTowerDefenseUpgradeEditForm } from "@/hooks/towerDefenseUpgrade";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import Loader from "@/layout/Loader";
import { getUpgradeColor, getUpgradeIcon } from "@/libs/towerDefense/upgrades";
import { canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import {
  type UpdateTowerDefenseUpgrade,
  updateTowerDefenseUpgradeSchema,
} from "@/validators/towerDefense";

export default function TowerDefenseUpgradeEdit(props: {
  params: Promise<{ upgradeid: string }>;
}) {
  const params = use(props.params);
  const upgradeId = params.upgradeid;

  const { userData, hasAccess } = useRequireRole(canChangeContent);

  // Queries
  const { data, isPending, isError, isFetching, refetch } =
    api.towerDefense.getUpgrade.useQuery(
      { id: upgradeId },
      { retry: false, enabled: !!upgradeId },
    );

  // Convert key null values to empty strings
  setNullsToEmptyStrings(data);

  if (isPending || !userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }
  if (!data) {
    return (
      <EditorQueryFeedback
        label="upgrade"
        subtitle="Upgrade Configuration"
        backHref="/manual/towerDefense/upgrades"
        isError={isError}
        isFetching={isFetching}
        onRetry={refetch}
      />
    );
  }

  return <SingleEditUpgrade upgrade={data} />;
}

interface SingleEditUpgradeProps {
  upgrade: TowerDefenseUpgrade;
}

const SingleEditUpgrade: React.FC<SingleEditUpgradeProps> = ({ upgrade }) => {
  const { form, formData, isUpdating, handleUpgradeSubmit } =
    useTowerDefenseUpgradeEditForm(upgrade);

  return (
    <ContentBox
      title="Content Panel"
      subtitle="Upgrade Configuration"
      defaultBackHref="/manual/towerDefense/upgrades"
    >
      {/* Upgrade Icon Display */}
      <div className="mb-6 flex items-center gap-3 rounded-lg bg-muted/50 p-4">
        <div
          className={`rounded-lg bg-background p-3 ${getUpgradeColor(upgrade.upgradeType)}`}
        >
          {getUpgradeIcon(upgrade.upgradeType, "h-8 w-8")}
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Upgrade Icon</p>
          <p className="text-muted-foreground text-xs">
            Icon is determined by the upgrade type
          </p>
        </div>
      </div>

      <EditContent
        schema={updateTowerDefenseUpgradeSchema}
        form={form as unknown as UseFormReturn<UpdateTowerDefenseUpgrade, unknown>}
        formData={formData}
        showSubmit={true}
        buttonTxt="Save to Database"
        type="towerDefenseUpgrade"
        relationId={upgrade.id}
        allowImageUpload={false}
        submitLoading={isUpdating}
        submitLoadingText="Saving"
        onAccept={handleUpgradeSubmit}
      />
    </ContentBox>
  );
};
