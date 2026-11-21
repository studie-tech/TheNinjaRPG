"use client";

import { useCaravans } from "@/hooks/useCaravans";
import BanInfo from "@/layout/BanInfo";
import { CaravansPanel, TradeRoutesPanel } from "@/layout/CaravanPanels";
import Loader from "@/layout/Loader";
import {
  WarehouseAccess,
  WarehouseHistory,
  WarehouseOverview,
  WarehouseProduction,
  WarehouseStock,
} from "@/layout/WarehousePanels";
import { useRequireInVillage } from "@/utils/UserContext";

/** The village Warehouse: shared stock, production, trade routes and caravans. */
export default function WarehousePage() {
  const { userData, access } = useRequireInVillage("/warehouse");
  const actions = useCaravans();
  const warehouse = actions.warehouse.data;
  const routes = actions.routes.data;
  const caravans = actions.caravans.data;

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Warehouse" />;
  if (userData.isBanned) return <BanInfo />;
  if (!warehouse) return <Loader explanation="Opening the Warehouse" />;
  const built = (warehouse.structure?.level ?? 0) > 0;
  return (
    <>
      <WarehouseOverview data={warehouse} actions={actions} clanId={userData.clanId} />
      {built && (
        <>
          <WarehouseStock data={warehouse} actions={actions} />
          {caravans && routes && (
            <CaravansPanel
              data={caravans}
              routes={routes}
              warehouse={warehouse}
              actions={actions}
            />
          )}
          {routes && (
            <TradeRoutesPanel
              data={routes}
              caravans={caravans ?? undefined}
              actions={actions}
            />
          )}
          {warehouse.isLeader && (
            <>
              <WarehouseProduction data={warehouse} actions={actions} />
              <WarehouseAccess data={warehouse} actions={actions} />
            </>
          )}
          <WarehouseHistory />
        </>
      )}
    </>
  );
}
