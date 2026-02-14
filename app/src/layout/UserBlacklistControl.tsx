"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, UserPlus } from "lucide-react";
import type React from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import AvatarImage from "@/layout/Avatar";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { getSearchValidator } from "@/validators/register";

const UserBlacklistControl: React.FC = () => {
  // Get react query utility
  const utils = api.useUtils();

  // Query
  const { data } = api.profile.getBlacklist.useQuery(undefined);

  // Mutations
  const { mutate: toggleEntry, isPending } =
    api.profile.toggleBlacklistEntry.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getBlacklist.invalidate();
          await utils.comments.getConversationComments.invalidate();
          await utils.comments.getUserConversations.invalidate();
        }
      },
    });

  // User search
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const targetUser = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // Render
  return (
    <div className="p-3">
      <div className="flex flex-col gap-1">
        <UserSearchSelect
          useFormMethods={userSearchMethods}
          label="Search user to blacklist"
          selectedUsers={[]}
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
                        userId={user.target.userId}
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

export default UserBlacklistControl;
