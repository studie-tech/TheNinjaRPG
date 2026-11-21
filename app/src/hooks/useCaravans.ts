import { api } from "@/app/_trpc/client";
import { useCombatEntry } from "@/hooks/combatEntry";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

/**
 * Warehouse, trade route and caravan reads with the mutations that change them. These views
 * are small and cheap, so confirmed mutations refetch them; inventory and profile updates go
 * through their shared caches, and battle starts enter combat directly.
 */
export const useCaravans = ({ controls = false }: { controls?: boolean } = {}) => {
  const utils = api.useUtils();
  const router = useRouter();
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const { prepareCombatEntry, loadBattle } = useCombatEntry();

  const warehouse = api.warehouse.getWarehouse.useQuery(undefined, {
    enabled: !controls,
    refetchInterval: 60_000,
  });
  const routes = api.tradeRoute.getRoutes.useQuery(undefined, { enabled: !controls });
  const caravans = api.caravan.getCaravans.useQuery(undefined, {
    enabled: !controls,
    refetchInterval: (query) => (query.state.data?.caravans.length ? 20_000 : 120_000),
  });
  const operations = api.caravanOps.getControls.useQuery(undefined, {
    enabled: controls,
    refetchInterval: (query) =>
      query.state.data?.operations.some((op) => op.status === "ACTIVE")
        ? 10_000
        : 30_000,
  });

  /** Refresh every caravan view after a confirmed change. */
  const refresh = () =>
    Promise.all([
      utils.warehouse.invalidate(),
      utils.tradeRoute.invalidate(),
      utils.caravan.invalidate(),
      utils.caravanOps.invalidate(),
    ]);
  const onResult = async (result: { success: boolean; message: string }) => {
    showMutationToast(result);
    if (result.success) await refresh();
  };
  const onInventoryResult = async (result: { success: boolean; message: string }) => {
    await onResult(result);
    if (result.success) await invalidateInventory();
  };
  const profileOptions = {
    onMutate: prepareUserUpdate,
    onSuccess: async (
      result: UserDeltaResponse,
      _variables: unknown,
      revision: number | undefined,
    ) => {
      await updateUser(result, { revision });
      await onResult(result);
    },
  };
  const battleOptions = {
    onMutate: () => {
      prepareCombatEntry();
      return prepareUserUpdate();
    },
    onSuccess: async (
      result: UserDeltaResponse & { battleId?: string },
      _variables: unknown,
      revision: number | undefined,
    ) => {
      if (result.success && result.battleId) {
        loadBattle(result.battleId);
        await updateUser(result, { revision, delta: result.userDelta });
        await refresh();
        pushToCombat(router, result.battleId);
      } else {
        await updateUser(result, { revision });
        await onResult(result);
      }
    },
  };

  return {
    warehouse,
    routes,
    caravans,
    operations,
    deposit: api.warehouse.deposit.useMutation({ onSuccess: onInventoryResult }),
    withdraw: api.warehouse.withdraw.useMutation({ onSuccess: onInventoryResult }),
    setProduction: api.warehouse.setProduction.useMutation({ onSuccess: onResult }),
    setApproval: api.warehouse.setApproval.useMutation({ onSuccess: onResult }),
    build: api.kage.upgradeStructure.useMutation({
      onSuccess: async (result) => {
        await onResult(result);
        if (result.success) await utils.village.get.invalidate();
      },
    }),
    propose: api.tradeRoute.propose.useMutation({ onSuccess: onResult }),
    respond: api.tradeRoute.respond.useMutation({ onSuccess: onResult }),
    closeRoute: api.tradeRoute.close.useMutation({ onSuccess: onResult }),
    upgradeRoute: api.tradeRoute.upgrade.useMutation({ onSuccess: onResult }),
    prepare: api.caravan.prepare.useMutation({ onSuccess: onResult }),
    cancel: api.caravan.cancel.useMutation({ onSuccess: onResult }),
    dispatch: api.caravan.dispatch.useMutation({ onSuccess: onResult }),
    joinEscort: api.caravan.joinEscort.useMutation(profileOptions),
    leaveEscort: api.caravan.leaveEscort.useMutation(profileOptions),
    rejoinEscort: api.caravan.rejoinEscort.useMutation(profileOptions),
    checkIn: api.caravan.checkIn.useMutation({ onSuccess: onResult }),
    defend: api.caravan.defend.useMutation(battleOptions),
    intervene: api.caravan.intervene.useMutation(battleOptions),
    setBandit: api.caravanOps.setBandit.useMutation({ onSuccess: onResult }),
    startOperation: api.caravanOps.startOperation.useMutation({ onSuccess: onResult }),
    track: api.caravanOps.track.useMutation({ onSuccess: onResult }),
    formGroup: api.caravanOps.formGroup.useMutation({ onSuccess: onResult }),
    leaveGroup: api.caravanOps.leaveGroup.useMutation({ onSuccess: onResult }),
    attack: api.caravanOps.attack.useMutation(battleOptions),
    claimLoot: api.caravanOps.claimLoot.useMutation({ onSuccess: onInventoryResult }),
    assaultMarker: api.caravanOps.assaultMarker.useMutation(battleOptions),
  };
};
