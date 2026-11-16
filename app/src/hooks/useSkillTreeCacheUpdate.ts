import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getPurchasedFolderStats, getPurchasedUserSkills } from "@/deltas/skillTree";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

type PurchaseResult = RouterOutputs["skillTree"]["purchaseSkill"];

/** Reconcile the owner's skills and folder progress with a confirmed skill purchase. */
export const useSkillTreeCacheUpdate = () => {
  const skills = useQueryCacheUpdate<RouterOutputs["skillTree"]["getUserSkills"]>(
    getQueryKey(api.skillTree.getUserSkills, undefined, "query"),
  );
  const folderStats = useQueryCacheUpdate<RouterOutputs["skillTree"]["getFolderStats"]>(
    getQueryKey(api.skillTree.getFolderStats, undefined, "query"),
  );
  /** Capture both revisions before sending the purchase. */
  const prepareSkillUpdate = () => ({
    skills: skills.prepareUpdate(),
    folderStats: folderStats.prepareUpdate(),
  });
  /** Apply the purchased row; a missing row or changed snapshot reads both views again. */
  const updateSkills = async (
    result: PurchaseResult,
    snapshot: ReturnType<typeof prepareSkillUpdate>,
  ) => {
    const purchase = result.success ? result.purchasedSkill : undefined;
    await Promise.all([
      skills.updateCache(
        (current) => getPurchasedUserSkills(current, purchase),
        snapshot.skills,
      ),
      folderStats.updateCache(
        (current) => getPurchasedFolderStats(current, purchase),
        snapshot.folderStats,
      ),
    ]);
  };
  return { prepareSkillUpdate, updateSkills };
};
