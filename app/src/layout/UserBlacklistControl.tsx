"use client";

import { UserPlus, UserRoundX } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBlacklistCacheUpdate } from "@/hooks/useBlacklistCacheUpdate";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { useUserPicker } from "@/utils/search";

const UserBlacklistControl: React.FC = () => {
  const { refreshBlacklist } = useBlacklistCacheUpdate();

  // Query
  const { data } = api.profile.getBlacklist.useQuery(undefined);

  // Mutations
  const { mutate: toggleEntry, isPending } =
    api.profile.toggleBlacklistEntry.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await refreshBlacklist();
        }
      },
    });

  // User search
  const maxUsers = 1;
  const { methods: userSearchMethods, user: targetUser } = useUserPicker(maxUsers);

  // Render
  return (
    <div className="p-3">
      <div className="flex flex-col gap-1">
        <UserSearchSelect
          useFormMethods={userSearchMethods}
          label="Search user to blacklist"
          showYourself={false}
          showAi={false}
          inline={true}
          maxUsers={maxUsers}
        />
        <Button
          className="w-full"
          type="submit"
          disabled={isPending || !targetUser}
          onClick={() => {
            if (targetUser) toggleEntry({ userId: targetUser.userId, active: true });
          }}
        >
          <UserPlus className="mr-2 h-5 w-5" />
          Add to blacklist
        </Button>
        {isPending && <Loader explanation="Updating blacklist" />}
        {!isPending && data && data.length > 0 && (
          <>
            <Label className="pt-2">Blacklisted members</Label>
            <p className="pb-1 text-xs italic">
              Hide their messages, do not show your messages to them
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {data
                ?.filter((u) => u.target)
                .map((user) => {
                  const username = user.target.username;
                  return (
                    <div
                      key={`blacklist-${user.target.userId}`}
                      className="flex min-w-0 flex-col items-center gap-1 text-xs"
                    >
                      <AvatarImage
                        href={user.target.avatar}
                        alt={username}
                        hover_effect={false}
                        size={100}
                      />
                      <span className="w-full truncate text-center" title={username}>
                        {username}
                      </span>
                      <Confirm
                        id={`unblock-${user.target.userId}`}
                        title={`Unblock ${username}?`}
                        triggerLabel={`Unblock ${username}`}
                        triggerClassName="w-full"
                        button={
                          <span className="w-full rounded-md border px-1 py-0.5 text-center hover:bg-muted">
                            Unblock
                          </span>
                        }
                        proceed_label="Unblock"
                        onAccept={() =>
                          toggleEntry({ userId: user.target.userId, active: false })
                        }
                      >
                        <p>
                          {username} will see your messages again, and you will see
                          theirs.
                        </p>
                      </Confirm>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** Toolbar button opening the blacklist editor. */
export const UserBlacklistPopover: React.FC = () => (
  <Popover>
    <PopoverTrigger asChild>
      <Button id="user-blacklist">
        <UserRoundX className="h-6 w-6 hover:text-orange-500" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-[300px] overflow-hidden p-0">
      <UserBlacklistControl />
    </PopoverContent>
  </Popover>
);

export default UserBlacklistControl;
