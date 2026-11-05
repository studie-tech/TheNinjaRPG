import { useRouter } from "next/navigation";
import { showMutationToast } from "@/libs/toast";

type ContentMutationResult = { success: boolean; message: string };

/**
 * `onSuccess` handlers of a content list's create and delete mutations. A created row
 * refreshes the list and opens at `${editPath}/<id>`; a failed create stays on the list.
 */
export const useContentListActions = (
  refetch: () => Promise<unknown>,
  editPath: string,
) => {
  const router = useRouter();
  return {
    onCreated: async (data: ContentMutationResult) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
        router.push(`${editPath}/${data.message}`);
      }
    },
    onDeleted: async (data: ContentMutationResult) => {
      showMutationToast(data);
      await refetch();
    },
  };
};
