import { showMutationToast } from "@/libs/toast";

/** Show committed recovery for feature callbacks whose normal success path has no outcome toast. */
export const showActionReadinessToast = (
  result: { actionNotice?: string } | null | undefined,
) => {
  if (result?.actionNotice)
    showMutationToast({
      success: true,
      title: "Character ready",
      message: result.actionNotice,
    });
};
