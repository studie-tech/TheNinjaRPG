import { FilePenLine, Loader2 } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { UserNindo } from "@/drizzle/schema";
import { GroupOrders } from "@/layout/GroupOrders";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

interface ClanOrdersProps {
  clanId: string;
  order: UserNindo | null;
  canPost: boolean;
}

/** Display clan or faction orders and allow authorized members to update the notice. */
export const ClanOrders: React.FC<ClanOrdersProps> = (props) => {
  // Destructure
  const { clanId, order, canPost } = props;
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    isOutlaw: u.isOutlaw,
  }));
  const groupLabel = userData?.isOutlaw ? "faction" : "clan";

  // utils
  const utils = api.useUtils();

  // Mutations
  const { mutateAsync: notice, isPending: isUpdatingOrders } =
    api.clan.upsertNotice.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) void utils.clan.get.invalidate();
      },
    });

  return (
    <GroupOrders
      title="Orders"
      subtitle={`From ${groupLabel} leader`}
      content={order?.content ?? `No current ${groupLabel} orders`}
      canPost={canPost}
      dialogId="update-clan-orders"
      isPending={isUpdatingOrders}
      onSubmit={(data) => notice({ ...data, clanId })}
      renderTrigger={(open) => (
        <Button
          id="create"
          disabled={isUpdatingOrders}
          aria-busy={isUpdatingOrders}
          aria-label={isUpdatingOrders ? "Updating" : "Update orders"}
          onClick={open}
        >
          {isUpdatingOrders ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <FilePenLine className="h-5 w-5" aria-hidden />
          )}
        </Button>
      )}
    />
  );
};
