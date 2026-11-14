import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { showMutationToast } from "@/libs/toast";

type ContentMutationResult = { success: boolean; message: string };

/**
 * `onSuccess` handlers of a content list's create and delete mutations. A created row
 * opens at `${editPath}/<id>` while the list refreshes in the background; a failed
 * create stays on the list. `isOpeningCreated` stays true until that navigation
 * finishes, so a create button can stay disabled from the click until the editor opens.
 */
export const useContentListActions = (
  refetch: () => Promise<unknown>,
  editPath: string,
) => {
  const router = useRouter();
  const [isOpeningCreated, startOpening] = useTransition();
  return {
    isOpeningCreated,
    onCreated: (data: ContentMutationResult) => {
      showMutationToast(data);
      if (data.success) {
        startOpening(() => router.push(`${editPath}/${data.message}`));
        void refetch();
      }
    },
    onDeleted: async (data: ContentMutationResult) => {
      showMutationToast(data);
      await refetch();
    },
  };
};
