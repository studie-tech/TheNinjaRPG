import { X } from "lucide-react";
import type React from "react";
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
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import AvatarImage from "@/layout/Avatar";
import { cn } from "@/libs/shadui";
import { getUnique } from "@/utils/grouping";
import type { UserSearchResult } from "@/validators/register";

interface UserSearchSelectProps {
  useFormMethods: UseFormReturn<
    {
      username: string;
      users: UserSearchResult[];
    },
    any
  >;
  showYourself: boolean;
  label?: string;
  inline?: boolean;
  maxUsers?: number;
  showAi?: boolean;
}

const UserSearchSelect: React.FC<UserSearchSelectProps> = (props) => {
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
  const searchTerm = useDebouncedValue(watchUsername);

  // Previous matches stay visible, dimmed, while the next search loads.
  const { data: searchResults, isPlaceholderData } = api.profile.searchUsers.useQuery(
    {
      username: searchTerm,
      showYourself: props.showYourself,
      showAi: props.showAi ?? true,
    },
    { enabled: searchTerm !== "", placeholderData: (previous) => previous },
  );

  const filteredUsers = watchUsers.filter((u) => u?.userId);

  const selectedVisual = filteredUsers.map((user) => (
    <span
      key={user.userId}
      className="inline-flex items-center rounded-lg border border-amber-900 bg-muted px-2 font-medium text-foreground text-sm"
    >
      <div className="m-1 w-8">
        <AvatarImage href={user.avatar} alt={user.username} size={100} />
      </div>
      <p className="whitespace-nowrap">{user.username}</p>
      <X
        className="ml-2 h-6 w-6 rounded-full hover:bg-accent"
        onClick={(e) => {
          e.preventDefault();
          form.setValue(
            "users",
            filteredUsers.filter((e) => e.userId !== user.userId),
          );
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
        <div className="mt-1 ml-1 flex w-full flex-row flex-wrap gap-1">
          {selectedVisual}
        </div>
      )}
      {searchResults && watchUsername && (
        <div
          aria-busy={isPlaceholderData}
          className={cn(
            "mt-1 w-full rounded-lg border-2 border-border bg-popover text-popover-foreground transition-opacity",
            isPlaceholderData && "opacity-60",
          )}
        >
          {searchResults?.map((user) => (
            <button
              type="button"
              className="flex w-full flex-row items-center p-2.5 text-left hover:bg-accent hover:text-accent-foreground"
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
                <AvatarImage href={user.avatar} alt={user.username} size={100} />
              </div>
              <div className="ml-2">
                <p>{user.username}</p>
                <p>
                  Lvl. {user.level} {user.rank}
                </p>
              </div>
            </button>
          ))}
          {searchResults.length === 0 && (
            <div className="p-2.5 text-muted-foreground">No users found</div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserSearchSelect;
