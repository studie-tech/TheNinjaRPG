"use client";

import { useCaravans } from "@/hooks/useCaravans";
import BanInfo from "@/layout/BanInfo";
import { CaravansPanel, TradeRoutesPanel } from "@/layout/CaravanPanels";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import {
  WarehouseAccess,
  WarehouseHistory,
  WarehouseOverview,
  WarehouseProduction,
  WarehouseStock,
} from "@/layout/WarehousePanels";
import { useRequireInVillage } from "@/utils/UserContext";

/** The village Warehouse: shared stock, production, trade routes and caravans. */
export function WarehouseScreen() {
  const { userData, access } = useRequireInVillage("/warehouse");
  const actions = useCaravans();
  const warehouse = actions.warehouse.data;
  const routes = actions.routes.data;
  const caravans = actions.caravans.data;

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Warehouse" />;
  if (userData.isBanned) return <BanInfo />;
  if (!warehouse && actions.warehouse.isError)
    return (
      <ContentBox title="Warehouse" defaultBackHref="/village">
        <QueryError
          layout="stacked"
          message="Could not open the Warehouse."
          messageClassName="mb-3"
          onRetry={() => void actions.warehouse.refetch()}
          isRetrying={actions.warehouse.isFetching}
        />
      </ContentBox>
    );
  if (!warehouse) return <Loader explanation="Opening the Warehouse" />;
  const built = (warehouse.structure?.level ?? 0) > 0;
  // Trade panels need both reads; a failed one is retried in their place.
  const failedTrade = [actions.routes, actions.caravans].filter(
    (query) => !query.data && query.isError,
  );
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
          {failedTrade.length > 0 && (
            <ContentBox title="Caravans" initialBreak>
              <QueryError
                layout="panel"
                message="Could not load the trade routes and caravans."
                onRetry={() => failedTrade.forEach((query) => void query.refetch())}
                isRetrying={failedTrade.some((query) => query.isFetching)}
              />
            </ContentBox>
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
