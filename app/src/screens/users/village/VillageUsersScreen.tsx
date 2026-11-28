"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useVillageKick } from "@/hooks/useVillageKick";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { UserInfoCell } from "@/layout/UserInfoCell";
import { VillageKickButton } from "@/layout/VillageKickButton";
import { useInfinitePagination } from "@/libs/pagination";
import { useUserSearch } from "@/utils/search";
import type { ArrayElement } from "@/utils/typeutils";

/** Render the users village screen independently of its route adapter. */
export function VillageUsersScreen(props: { params: { villageid: string } }) {
  const params = props.params;
  const villageId = params.villageid;
  const tabNames = ["Online", "Strongest"] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabNames)[number]>("Online");
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const { form, searchTerm } = useUserSearch();
  const kick = useVillageKick(villageId);
  const coolingDown = !!kick.availableAt && kick.availableAt.getTime() > Date.now();

  const {
    data: users,
    fetchNextPage,
    hasNextPage,
  } = api.profile.getPublicUsers.useInfiniteQuery(
    {
      limit: 30,
      orderBy: activeTab,
      username: searchTerm,
      village: villageId,
      isAi: false,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      staleTime: 1000 * 60 * 5, // every 5min
    },
  );
  const allUsers = users?.pages
    .flatMap((page) => page.data)
    .map((user) => ({
      ...user,
      info: <UserInfoCell user={user} />,
      kick:
        kick.canKick && user.userId !== kick.actorId ? (
          <VillageKickButton
            username={user.username}
            disabled={coolingDown || kick.isPending}
            isPending={kick.isPending}
            onKick={(reason, close) =>
              kick.mutate(
                { userId: user.userId, reason },
                {
                  onSuccess: (result) => {
                    if (result.success) close();
                  },
                },
              )
            }
          />
        ) : null,
    }));
  const villageName = allUsers?.find((user) => user.village?.name)?.village?.name;
  type User = ArrayElement<typeof allUsers>;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  const columns: ColumnDefinitionType<User, keyof User>[] = [
    { key: "avatar", header: "", type: "avatar" },
    { key: "info", header: "Info", type: "jsx" },
  ];
  if (kick.canKick) columns.push({ key: "kick", header: "Expel", type: "jsx" });
  if (activeTab === "Strongest") {
    columns.push({ key: "experience", header: "Experience", type: "string" });
  } else if (activeTab === "Online") {
    columns.push({ key: "updatedAt", header: "Last Active", type: "time_passed" });
  }

  if (!users) return <Loader explanation="Loading information" />;

  return (
    <ContentBox
      title={villageName ? `${villageName} members` : "Village members"}
      subtitle={`${activeTab} users`}
      defaultBackHref="/village"
      padding={false}
      topRightContent={
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="max-w-40">
            <Form {...form}>
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem className="w-full">
                    <FormControl>
                      <Input id="username" placeholder="Search" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </Form>
          </div>
          <NavTabs current={activeTab} options={tabNames} setValue={setActiveTab} />
        </div>
      }
    >
      {kick.canKick && coolingDown && (
        <p className="p-3 text-sm">
          You can expel another player after {kick.availableAt?.toLocaleString()}.
        </p>
      )}
      <Table
        data={allUsers}
        columns={columns}
        linkPrefix="/username/"
        linkColumn={"username"}
        setLastElement={setLastElement}
      />
    </ContentBox>
  );
}
