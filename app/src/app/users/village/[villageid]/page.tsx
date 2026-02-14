"use client";

import { use, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { useInfinitePagination } from "@/libs/pagination";
import { useUserSearch } from "@/utils/search";
import type { ArrayElement } from "@/utils/typeutils";

export default function VillageUsers(props: {
  params: Promise<{ villageid: string }>;
}) {
  const params = use(props.params);
  const villageId = params.villageid;
  const tabNames = ["Online", "Strongest"] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabNames)[number]>("Online");
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const { form, searchTerm } = useUserSearch();

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
  const allUsers = users?.pages.flatMap((page) => page.data);
  type User = ArrayElement<typeof allUsers>;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  const columns: ColumnDefinitionType<User, keyof User>[] = [
    { key: "avatar", header: "", type: "avatar" },
    { key: "username", header: "Username", type: "string" },
    { key: "rank", header: "Rank", type: "capitalized" },
  ];
  if (activeTab === "Strongest") {
    columns.push({ key: "level", header: "Lvl.", type: "string" });
    columns.push({ key: "experience", header: "Experience", type: "string" });
  } else if (activeTab === "Online") {
    columns.push({ key: "updatedAt", header: "Last Active", type: "time_passed" });
  }

  if (!users) return <Loader explanation="Loading information" />;

  return (
    <ContentBox
      title="Village Users"
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
