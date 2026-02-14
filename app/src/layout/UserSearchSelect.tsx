import { X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { FederalStatus, UserRank } from "@/drizzle/schema";
import { getUnique } from "@/utils/grouping";
import AvatarImage from "./Avatar";

type SelectedUser = {
  username: string;
  avatar: string | null;
  federalStatus: FederalStatus;
  userId: string;
};

interface UserSearchSelectProps {
  useFormMethods: UseFormReturn<
    {
      username: string;
      users: {
        userId: string;
        username: string;
        rank: UserRank;
        level: number;
        avatar?: string | null;
        federalStatus: FederalStatus;
      }[];
    },
    any
  >;
  selectedUsers?: SelectedUser[];
  showYourself: boolean;
  label?: string;
  inline?: boolean;
  maxUsers?: number;
  showAi?: boolean;
}

const UserSearchSelect: React.FC<UserSearchSelectProps> = (props) => {
  const [searchTerm, setSearchTerm] = useState("");

  const form = props.useFormMethods;

  const watchUsername = useWatch({
    control: form.control,
    name: "username",
    defaultValue: "",
  });
  const watchUsers = useWatch({
    control: form.control,
    name: "users",
    defaultValue: [],
  });

  const { data: searchResults } = api.profile.searchUsers.useQuery(
    {
      username: searchTerm,
      showYourself: props.showYourself,
      showAi: props.showAi ?? true,
    },
    { enabled: searchTerm !== "" },
  );

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setSearchTerm(watchUsername);
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchUsername, setSearchTerm]);

  const filteredUsers = watchUsers.filter((u) => u?.userId);

  const selectedVisual = filteredUsers.map((user) => (
    <span
      key={user.userId}
      className="inline-flex items-center rounded-lg border border-amber-900 bg-gray-100 px-2 font-medium text-gray-800 text-sm"
    >
      <div className="m-1 w-8">
        <AvatarImage
          href={user.avatar}
          userId={user.userId}
          alt={user.username}
          size={100}
          priority
        />
      </div>
      <p className="whitespace-nowrap">{user.username}</p>
      <X
        className="ml-2 h-6 w-6 rounded-full hover:bg-gray-300"
        onClick={(e) => {
          e.preventDefault();
          if (watchUsers && user.userId) {
            const newSelected = getUnique(
              filteredUsers.filter((e) => e.userId !== user.userId),
              "userId",
            );
            form.setValue("users", newSelected);
          }
        }}
      />
    </span>
  ));

  return (
    <div className="flex w-full flex-col items-center">
      <div className="flex w-full flex-row items-center gap-1">
        <Form {...form}>
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem className="flex w-full flex-col">
                <FormControl>
                  <Input
                    id="username"
                    placeholder={props.label ?? "Search username"}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
        {props.inline && selectedVisual}
      </div>
      {!props.inline && (
        <div className="mt-1 ml-1 flex w-full flex-row">{selectedVisual}</div>
      )}
      {searchResults && watchUsername && (
        <div className="mt-1 w-full rounded-lg border-2 border-slate-500 bg-slate-100">
          {searchResults?.map((user) => (
            <button
              type="button"
              className="flex w-full flex-row items-center p-2.5 text-left hover:bg-slate-200"
              key={user.userId}
              onClick={(e) => {
                e.preventDefault();
                let newSelected = getUnique([...watchUsers, user], "userId");
                if (props.maxUsers && newSelected.length > props.maxUsers) {
                  newSelected = newSelected.slice(1);
                }
                form.setValue("username", "");
                form.setValue("users", newSelected);
              }}
            >
              <div className="basis-1/12">
                <AvatarImage
                  href={user.avatar}
                  userId={user.userId}
                  alt={user.username}
                  size={100}
                  priority
                />
              </div>
              <div className="ml-2 text-black">
                <p>{user.username}</p>
                <p>
                  Lvl. {user.level} {user.rank}
                </p>
              </div>
            </button>
          ))}
          {searchResults.length === 0 && <div className="p-2.5">No users found</div>}
        </div>
      )}
    </div>
  );
};

export default UserSearchSelect;
