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

interface ClanSearchSelectProps {
  useFormMethods: UseFormReturn<
    {
      name: string;
      clans: {
        id: string;
        name: string;
        image?: string | null;
      }[];
    },
    any
  >;
  userClanId?: string | null;
  label?: string;
}

/** Pick one clan other than `userClanId`, shown as a chip beside the search field. */
const ClanSearchSelect: React.FC<ClanSearchSelectProps> = (props) => {
  const form = props.useFormMethods;

  const watchName = useWatch({ control: form.control, name: "name", defaultValue: "" });
  const watchClans = useWatch({
    control: form.control,
    name: "clans",
    defaultValue: [],
  });
  const searchTerm = useDebouncedValue(watchName);

  // Previous matches stay visible, dimmed, while the next search loads.
  const { data: searchResults, isPlaceholderData } = api.clan.searchClans.useQuery(
    { name: searchTerm },
    { enabled: searchTerm !== "", placeholderData: (previous) => previous },
  );

  const selectedVisual = watchClans.map((clan) => (
    <span
      key={clan.id}
      className="mr-2 inline-flex items-center rounded-lg border border-amber-900 bg-muted px-2 font-medium text-foreground text-sm"
    >
      <div className="m-1 w-8">
        <AvatarImage href={clan.image} alt={clan.name} size={100} />
      </div>
      {clan.name}
      <X
        className="ml-2 h-6 w-6 rounded-full hover:bg-accent"
        onClick={(e) => {
          e.preventDefault();
          form.setValue(
            "clans",
            watchClans.filter((e) => e.id !== clan.id),
          );
        }}
      />
    </span>
  ));

  return (
    <div className="flex w-full flex-col items-center">
      <div className="flex w-full flex-row items-center">
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="mx-1 flex w-full flex-col">
                <FormControl>
                  <Input
                    id="name"
                    placeholder={props.label ?? "Search clan"}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
        {selectedVisual}
      </div>
      {searchResults && watchName && (
        <div
          aria-busy={isPlaceholderData}
          className={cn(
            "mt-1 w-full rounded-lg border-2 border-border bg-popover text-popover-foreground transition-opacity",
            isPlaceholderData && "opacity-60",
          )}
        >
          {searchResults
            ?.filter((c) => c.id !== props.userClanId)
            .map((clan) => (
              <button
                type="button"
                className="flex w-full flex-row items-center p-2.5 text-left hover:bg-accent hover:text-accent-foreground"
                key={clan.id}
                onClick={(e) => {
                  e.preventDefault();
                  form.setValue("name", "");
                  form.setValue("clans", [clan]);
                }}
              >
                <div className="basis-1/12">
                  <AvatarImage href={clan.image} alt={clan.name} size={100} />
                </div>
                <div className="ml-2">
                  <p>{clan.name}</p>
                </div>
              </button>
            ))}
          {searchResults.length === 0 && (
            <div className="p-2.5 text-muted-foreground">No clans found</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClanSearchSelect;
