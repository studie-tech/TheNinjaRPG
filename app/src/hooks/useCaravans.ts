import type { InfiniteData } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getActivatedTradeRoutes,
  getBanditControls,
  getCancelledCaravans,
  getCheckedInCaravans,
  getClaimedLootControls,
  getDepartedCaravans,
  getGroupControls,
  getJoinedEscortCaravans,
  getLeftEscortCaravans,
  getLeftGroupControls,
  getPreparedCaravans,
  getProposedTradeRoutes,
  getRejoinedEscortCaravans,
  getRemovedTradeRoutes,
  getStartedOperationControls,
  getStoppedSabotageCaravans,
  getTrackedControls,
  getUpgradedTradeRoutes,
  hasCaravanStockMoved,
} from "@/deltas/caravan";
import { getInventoryQuantities } from "@/deltas/item";
import { applyWarehouseChange, getWarehouseHistoryWithLogs } from "@/deltas/warehouse";
import {
  CARAVAN_SABOTAGE_MINUTES,
  WAREHOUSE_HISTORY_PAGE_SIZE,
} from "@/drizzle/constants";
import { useCombatEntry } from "@/hooks/combatEntry";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { getCheckpointTimes } from "@/libs/caravan";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Other players change these views too; the fallback reads catch what no deadline marks. */
const QUIET_REFRESH_MS = 5 * 60_000;
const ACTIVE_REFRESH_MS = 60_000;
const GROUP_REFRESH_MS = 15_000;
const HISTORY_INPUT = { limit: WAREHOUSE_HISTORY_PAGE_SIZE };

/**
 * Warehouse, trade route and caravan reads with the mutations that change them. Confirmed
 * mutations patch the views they changed from their responses, against the revisions
 * captured when they started; a view a response withholds, a rejection or a lost response
 * reloads only that view. Reads refresh at the deadlines they list, with a slow fallback
 * for other players' actions, and battle starts enter combat as soon as they are confirmed.
 */
export const useCaravans = ({ controls = false }: { controls?: boolean } = {}) => {
  const utils = api.useUtils();
  const router = useRouter();
  const { timeDiff, prepareUserUpdate, updateUser } = useRequiredUserData();
  const inventory = useInventoryCacheUpdate();
  const { prepareCombatEntry, loadBattle } = useCombatEntry();

  // A return visit reads again: deadlines may have passed and others acted meanwhile.
  const warehouse = api.warehouse.getWarehouse.useQuery(undefined, {
    enabled: !controls,
    refetchOnMount: "always",
    refetchInterval: QUIET_REFRESH_MS,
  });
  const routes = api.tradeRoute.getRoutes.useQuery(undefined, {
    enabled: !controls,
    refetchOnMount: "always",
    refetchInterval: QUIET_REFRESH_MS,
  });
  const caravans = api.caravan.getCaravans.useQuery(undefined, {
    enabled: !controls,
    refetchOnMount: "always",
    refetchInterval: (query) =>
      query.state.data?.caravans.length ? ACTIVE_REFRESH_MS : QUIET_REFRESH_MS,
  });
  const operations = api.caravanOps.getControls.useQuery(undefined, {
    enabled: controls,
    // The controls describe the viewer's current sector, which can change between visits.
    refetchOnMount: "always",
    // Raiders gather in groups, so a committed raider follows their group closely.
    refetchInterval: (query) =>
      query.state.data?.commitment && query.state.data.commitment.role !== "GUARD"
        ? GROUP_REFRESH_MS
        : query.state.data?.caravans.length
          ? ACTIVE_REFRESH_MS
          : QUIET_REFRESH_MS,
  });
  useRefreshAt(
    [
      warehouse.data?.nextCycleAt,
      ...(warehouse.data?.depositCandidates.map((row) => row.availableAt) ?? []),
    ],
    () => void warehouse.refetch({ cancelRefetch: false }),
    timeDiff,
    !controls,
  );
  useRefreshAt(
    caravans.data?.caravans.flatMap((row) => [
      row.arrivesAt,
      row.encounter?.expiresAt,
      ...getCheckpointTimes(row),
      ...row.sabotage.map((op) => op.finishesAt),
    ]) ?? [],
    () => void caravans.refetch({ cancelRefetch: false }),
    timeDiff,
    !controls,
  );
  useRefreshAt(
    [
      ...(operations.data?.operations.flatMap((op) =>
        op.status === "ACTIVE" ? [op.finishesAt] : [],
      ) ?? []),
      // Sabotage closes ahead of arrival, so the controls also refresh at that cutoff.
      ...(operations.data?.caravans.flatMap((row) =>
        row.arrivesAt
          ? [
              row.arrivesAt,
              new Date(row.arrivesAt).getTime() - CARAVAN_SABOTAGE_MINUTES * 60_000,
            ]
          : [],
      ) ?? []),
    ],
    () => void operations.refetch({ cancelRefetch: false }),
    timeDiff,
    controls,
  );

  const views = {
    warehouse: useQueryCacheUpdate<RouterOutputs["warehouse"]["getWarehouse"]>(
      getQueryKey(api.warehouse.getWarehouse, undefined, "query"),
    ),
    history: useQueryCacheUpdate<
      InfiniteData<RouterOutputs["warehouse"]["getHistory"]>
    >(getQueryKey(api.warehouse.getHistory, HISTORY_INPUT, "infinite")),
    routes: useQueryCacheUpdate<RouterOutputs["tradeRoute"]["getRoutes"]>(
      getQueryKey(api.tradeRoute.getRoutes, undefined, "query"),
    ),
    caravans: useQueryCacheUpdate<RouterOutputs["caravan"]["getCaravans"]>(
      getQueryKey(api.caravan.getCaravans, undefined, "query"),
    ),
    controls: useQueryCacheUpdate<RouterOutputs["caravanOps"]["getControls"]>(
      getQueryKey(api.caravanOps.getControls, undefined, "query"),
    ),
  };
  type Snapshot = {
    [View in keyof typeof views]: ReturnType<(typeof views)[View]["prepareUpdate"]>;
  };
  /** Capture every view's revision when a mutation starts. */
  const prepareViews = (): Snapshot => ({
    warehouse: views.warehouse.prepareUpdate(),
    history: views.history.prepareUpdate(),
    routes: views.routes.prepareUpdate(),
    caravans: views.caravans.prepareUpdate(),
    controls: views.controls.prepareUpdate(),
  });
  /** Reload views whose outcome a response does not describe, without holding the action. */
  const reload = (snapshot: Snapshot, names: (keyof typeof views)[]) => {
    for (const name of names) void views[name].updateCache(undefined, snapshot[name]);
  };
  // Caravans that moved the village's stock reload it, whoever moved them; the viewer's own
  // prepare, dispatch or cancel, already patched from its response, reads it once more.
  const shownCaravans = useRef<CaravansView | undefined>(undefined);
  const onCaravansShown = useEffectEvent((current: CaravansView | undefined) => {
    const shown = shownCaravans.current;
    shownCaravans.current = current;
    if (hasCaravanStockMoved(shown, current))
      reload(prepareViews(), ["warehouse", "history"]);
  });
  useEffect(() => {
    if (!controls) onCaravansShown(caravans.data);
  }, [controls, caravans.data]);
  /**
   * Patch the Warehouse from a confirmed change, and the history with the logs the change
   * wrote: `patch` applies the returned logs, `reload` reads logs it does not return.
   */
  const updateStock = (
    result: RouterOutputs["warehouse"]["withdraw"],
    snapshot: Snapshot,
    history?: "patch" | "reload",
  ) => {
    const change = result.warehouseChange;
    const logs = result.warehouseLogs;
    void views.warehouse.updateCache(
      change && ((current) => applyWarehouseChange(current, change)),
      snapshot.warehouse,
    );
    if (!history) return;
    void views.history.updateCache(
      history === "patch" && logs
        ? (current) => getWarehouseHistoryWithLogs(current, logs)
        : undefined,
      snapshot.history,
    );
  };
  /**
   * Bind a mutation to the views it changes: a confirmation applies `patch`, while a
   * rejection or a lost response reloads `affected`.
   */
  const bind = <Result extends { success: boolean; message: string }, Input>(
    affected: (keyof typeof views)[],
    patch: (result: Result, input: Input, snapshot: Snapshot) => void,
  ) => ({
    onMutate: prepareViews,
    onSuccess: (result: Result, input: Input, snapshot: Snapshot) => {
      showMutationToast(result);
      if (result.success) patch(result, input, snapshot);
      else reload(snapshot, affected);
    },
    onError: (_error: unknown, _input: Input, snapshot: Snapshot | undefined) => {
      if (snapshot) reload(snapshot, affected);
    },
  });
  /**
   * Bind a mutation that can also change the viewer's profile, such as waking them or
   * releasing their escort: a response applies the profile change it confirms, and a lost
   * response reloads the profile with the views.
   */
  const bindProfile = <Result extends UserDeltaResponse, Input>(
    affected: (keyof typeof views)[],
    patch: (result: Result, input: Input, snapshot: Snapshot) => void,
  ) => {
    const options = bind<Result, Input>(affected, patch);
    return {
      onMutate: () => ({ views: options.onMutate(), user: prepareUserUpdate() }),
      onSuccess: async (
        result: Result,
        input: Input,
        snapshot: { views: Snapshot; user: number | undefined },
      ) => {
        options.onSuccess(result, input, snapshot.views);
        if (result.userPatch || result.userRecovery)
          await updateUser(result, { revision: snapshot.user, refetch: false });
      },
      onError: async (
        error: unknown,
        input: Input,
        snapshot: { views: Snapshot; user: number | undefined } | undefined,
      ) => {
        options.onError(error, input, snapshot?.views);
        if (snapshot) await updateUser(undefined, { revision: snapshot.user });
      },
    };
  };
  /** Escort changes also patch the profile; a rejection applies only confirmed recovery. */
  const bindEscort = <Result extends UserDeltaResponse, Input>(
    patch: (result: Result, input: Input, snapshot: Snapshot) => void,
  ) => ({
    onMutate: () => ({ views: prepareViews(), user: prepareUserUpdate() }),
    onSuccess: async (
      result: Result,
      input: Input,
      snapshot: { views: Snapshot; user: number | undefined },
    ) => {
      showMutationToast(result);
      if (result.success) {
        patch(result, input, snapshot.views);
        // The viewer's commitment shows in the caravan controls as well.
        reload(snapshot.views, ["controls"]);
        await updateUser(result, { revision: snapshot.user });
      } else {
        reload(snapshot.views, ["caravans"]);
        if (result.userRecovery)
          await updateUser(result, { revision: snapshot.user, refetch: false });
      }
    },
    onError: async (
      _error: unknown,
      _input: Input,
      snapshot: { views: Snapshot; user: number | undefined } | undefined,
    ) => {
      if (!snapshot) return;
      reload(snapshot.views, ["caravans", "controls"]);
      await updateUser(undefined, { revision: snapshot.user });
    },
  });
  /**
   * Battle starts enter combat as soon as the profile shows the battle; the views they
   * leave behind reload on the next visit. A start without a battle patches `patch`.
   */
  const bindBattle = <Result extends UserDeltaResponse & { battleId?: string }, Input>(
    affected: "caravans" | "controls",
    patch?: (result: Result, input: Input, snapshot: Snapshot) => void,
  ) => ({
    onMutate: () => {
      prepareCombatEntry();
      return { views: prepareViews(), user: prepareUserUpdate() };
    },
    onSuccess: async (
      result: Result,
      input: Input,
      snapshot: { views: Snapshot; user: number | undefined },
    ) => {
      if (result.success && result.battleId) {
        loadBattle(result.battleId);
        await updateUser(result, { revision: snapshot.user, refetch: false });
        void utils.caravan.getCaravans.invalidate(undefined, { refetchType: "none" });
        void utils.caravanOps.getControls.invalidate(undefined, {
          refetchType: "none",
        });
        pushToCombat(router, result.battleId);
        return;
      }
      showMutationToast(result);
      if (result.success && patch) patch(result, input, snapshot.views);
      else reload(snapshot.views, [affected]);
      if (result.userRecovery)
        await updateUser(result, { revision: snapshot.user, refetch: false });
    },
    onError: async (
      _error: unknown,
      _input: Input,
      snapshot: { views: Snapshot; user: number | undefined } | undefined,
    ) => {
      if (!snapshot) return;
      reload(snapshot.views, [affected]);
      await updateUser(undefined, { revision: snapshot.user });
    },
  });
  /** Inventory movements patch known stack quantities and reload the views otherwise. */
  const bindInventory = <
    Result extends { success: boolean; message: string; inventoryChanges?: unknown },
    Input,
  >(
    affected: (keyof typeof views)[],
    patch: (result: Result, input: Input, snapshot: Snapshot) => void,
  ) => {
    const options = bind<Result, Input>(affected, patch);
    return {
      onMutate: () => ({
        views: options.onMutate(),
        inventory: inventory.prepareInventoryUpdate(),
      }),
      onSuccess: (
        result: Result,
        input: Input,
        snapshot: {
          views: Snapshot;
          inventory: ReturnType<typeof inventory.prepareInventoryUpdate>;
        },
      ) => {
        options.onSuccess(result, input, snapshot.views);
        if (!result.success) return;
        const changes = result.inventoryChanges as Parameters<
          typeof getInventoryQuantities
        >[1];
        void inventory.updateInventory(
          changes && ((rows) => getInventoryQuantities(rows, changes)),
          snapshot.inventory,
        );
      },
      onError: (
        error: unknown,
        input: Input,
        snapshot:
          | {
              views: Snapshot;
              inventory: ReturnType<typeof inventory.prepareInventoryUpdate>;
            }
          | undefined,
      ) => {
        options.onError(error, input, snapshot?.views);
        if (snapshot) void inventory.updateInventory(undefined, snapshot.inventory);
      },
    };
  };

  return {
    warehouse,
    routes,
    caravans,
    operations,
    deposit: api.warehouse.deposit.useMutation(
      bindInventory(["warehouse"], (result, _input, snapshot) =>
        updateStock(result, snapshot, "patch"),
      ),
    ),
    withdraw: api.warehouse.withdraw.useMutation(
      bindInventory(["warehouse"], (result, _input, snapshot) =>
        updateStock(result, snapshot, "patch"),
      ),
    ),
    // A withheld change settled production, which also logged it.
    setProduction: api.warehouse.setProduction.useMutation(
      bind(["warehouse"], (result, _input, snapshot) =>
        updateStock(result, snapshot, result.warehouseChange ? undefined : "reload"),
      ),
    ),
    setApproval: api.warehouse.setApproval.useMutation(
      bind(["warehouse"], (result, _input, snapshot) => updateStock(result, snapshot)),
    ),
    // A built level changes bonuses, costs and trade access; the views reload.
    build: api.kage.upgradeStructure.useMutation(
      bind(["warehouse"], (_result, _input, snapshot) => {
        reload(snapshot, ["warehouse", "routes"]);
        void utils.village.get.invalidate();
      }),
    ),
    propose: api.tradeRoute.propose.useMutation(
      bind(["routes"], (result, _input, snapshot) => {
        const proposed = result.proposed;
        void views.routes.updateCache(
          proposed && ((current) => getProposedTradeRoutes(current, proposed)),
          snapshot.routes,
        );
      }),
    ),
    respond: api.tradeRoute.respond.useMutation(
      bind(["routes"], (result, _input, snapshot) => {
        const { activated, removed } = result;
        void views.routes.updateCache(
          activated
            ? (current) => getActivatedTradeRoutes(current, activated)
            : removed && ((current) => getRemovedTradeRoutes(current, removed)),
          snapshot.routes,
        );
      }),
    ),
    closeRoute: api.tradeRoute.close.useMutation(
      bindProfile(["routes"], (result, _input, snapshot) => {
        const removed = result.removed;
        void views.routes.updateCache(
          removed && ((current) => getRemovedTradeRoutes(current, removed)),
          snapshot.routes,
        );
        // Called-off caravans leave the list, which reloads the stock they return.
        if (removed?.caravansChanged) reload(snapshot, ["caravans"]);
      }),
    ),
    upgradeRoute: api.tradeRoute.upgrade.useMutation(
      bind(["routes"], (result, _input, snapshot) => {
        const upgraded = result.upgraded;
        void views.routes.updateCache(
          upgraded && ((current) => getUpgradedTradeRoutes(current, upgraded)),
          snapshot.routes,
        );
        updateStock(result, snapshot);
      }),
    ),
    prepare: api.caravan.prepare.useMutation(
      // A rejection can follow a route blocked or closed since the routes were read.
      bind(["warehouse", "caravans", "routes"], (result, _input, snapshot) => {
        const prepared = result.prepared;
        void views.caravans.updateCache(
          prepared && ((current) => getPreparedCaravans(current, prepared)),
          snapshot.caravans,
        );
        updateStock(result, snapshot, "patch");
      }),
    ),
    cancel: api.caravan.cancel.useMutation(
      bindProfile(["caravans"], (result, _input, snapshot) => {
        const cancelled = result.cancelled;
        void views.caravans.updateCache(
          cancelled && ((current) => getCancelledCaravans(current, cancelled)),
          snapshot.caravans,
        );
        updateStock(result, snapshot, "reload");
      }),
    ),
    dispatch: api.caravan.dispatch.useMutation(
      bind(["caravans"], (result, _input, snapshot) => {
        const departed = result.departed;
        void views.caravans.updateCache(
          departed && ((current) => getDepartedCaravans(current, departed)),
          snapshot.caravans,
        );
        updateStock(result, snapshot, "reload");
      }),
    ),
    joinEscort: api.caravan.joinEscort.useMutation(
      bindEscort((result, input: { caravanId: string }, snapshot) => {
        const guard = result.guard;
        void views.caravans.updateCache(
          guard &&
            ((current) => getJoinedEscortCaravans(current, input.caravanId, guard)),
          snapshot.caravans,
        );
      }),
    ),
    leaveEscort: api.caravan.leaveEscort.useMutation(
      bindEscort((result, input: { caravanId: string }, snapshot) => {
        const guardId = result.guardId;
        void views.caravans.updateCache(
          guardId
            ? (current) => getLeftEscortCaravans(current, input.caravanId, guardId)
            : undefined,
          snapshot.caravans,
        );
      }),
    ),
    rejoinEscort: api.caravan.rejoinEscort.useMutation(
      bindEscort((result, input: { caravanId: string }, snapshot) => {
        const guardId = result.guardId;
        void views.caravans.updateCache(
          guardId
            ? (current) => getRejoinedEscortCaravans(current, input.caravanId, guardId)
            : undefined,
          snapshot.caravans,
        );
      }),
    ),
    checkIn: api.caravan.checkIn.useMutation(
      bind(["caravans"], (result, input: { caravanId: string }, snapshot) => {
        const guardId = result.guardId;
        void views.caravans.updateCache(
          guardId
            ? (current) => getCheckedInCaravans(current, input.caravanId, guardId)
            : undefined,
          snapshot.caravans,
        );
      }),
    ),
    defend: api.caravan.defend.useMutation(bindBattle("caravans")),
    intervene: api.caravan.intervene.useMutation(
      bindBattle(
        "caravans",
        (_result, input: { caravanId: string; operationId: string }, snapshot) =>
          void views.caravans.updateCache(
            (current) =>
              getStoppedSabotageCaravans(current, input.caravanId, input.operationId),
            snapshot.caravans,
          ),
      ),
    ),
    setBandit: api.caravanOps.setBandit.useMutation(
      bind(["controls"], (_result, input: { enabled: boolean }, snapshot) => {
        void views.controls.updateCache(
          (current) => getBanditControls(current, input.enabled),
          snapshot.controls,
        );
      }),
    ),
    startOperation: api.caravanOps.startOperation.useMutation(
      bindProfile(["controls"], (result, _input, snapshot) => {
        const operation = result.operation;
        void views.controls.updateCache(
          operation && ((current) => getStartedOperationControls(current, operation)),
          snapshot.controls,
        );
      }),
    ),
    track: api.caravanOps.track.useMutation(
      bind(["controls"], (result, _input, snapshot) => {
        const sighting = result.sighting;
        void views.controls.updateCache(
          sighting && ((current) => getTrackedControls(current, sighting)),
          snapshot.controls,
        );
      }),
    ),
    formGroup: api.caravanOps.formGroup.useMutation(
      bind(["controls"], (result, _input, snapshot) => {
        const group = result.group;
        void views.controls.updateCache(
          group && ((current) => getGroupControls(current, group)),
          snapshot.controls,
        );
      }),
    ),
    leaveGroup: api.caravanOps.leaveGroup.useMutation(
      bind(["controls"], (result, _input, snapshot) => {
        const left = result.left;
        void views.controls.updateCache(
          left && ((current) => getLeftGroupControls(current, left)),
          snapshot.controls,
        );
      }),
    ),
    attack: api.caravanOps.attack.useMutation(bindBattle("controls")),
    // Filled backpack stacks change their snapshot time in SQL, so the inventory reloads.
    claimLoot: api.caravanOps.claimLoot.useMutation(
      bindInventory(["controls"], (_result, input: { caravanId: string }, snapshot) => {
        void views.controls.updateCache(
          (current) => getClaimedLootControls(current, input.caravanId),
          snapshot.controls,
        );
        reload(snapshot, ["warehouse"]);
      }),
    ),
    assaultMarker: api.caravanOps.assaultMarker.useMutation(bindBattle("controls")),
  };
};

/** The Warehouse's paged history, newest first, under the key mutations patch. */
export const useWarehouseHistory = () =>
  api.warehouse.getHistory.useInfiniteQuery(HISTORY_INPUT, {
    getNextPageParam: (page) => page.nextCursor,
  });

type CaravansView = RouterOutputs["caravan"]["getCaravans"];
