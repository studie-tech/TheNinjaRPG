"use client";

import { Ban, UserPlus, UserRoundX } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBlacklistCacheUpdate } from "@/hooks/useBlacklistCacheUpdate";
import AvatarImage from "@/layout/Avatar";
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
          onClick={() => toggleEntry({ userId: targetUser?.userId || "" })}
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
            <div className="grid grid-cols-6">
              {data
                ?.filter((u) => u.target)
                .map((user) => {
                  return (
                    <div
                      key={`blacklist-${user.target.userId}`}
                      className="relative flex flex-col items-center text-xs"
                    >
                      <AvatarImage
                        href={user.target.avatar}
                        alt={user.target.username}
                        hover_effect={false}
                        size={100}
                      />
                      {user.target.username}
                      <Ban
                        className="absolute top-0 right-0 h-8 w-8 rounded-full bg-red-500 p-1 hover:cursor-pointer hover:text-orange-500"
                        onClick={() =>
                          toggleEntry({ userId: user.target.userId || "" })
                        }
                      />
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
