"use client";

import { ChartCandlestick, ChartPie, FilePlus, ListChecks } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import ItemFiltering, { getFilter, useFiltering } from "@/layout/ItemFiltering";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualItems() {
  // Settings
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Router for forwarding
  const router = useRouter();

  //Two-Way Filtering
  const state = useFiltering();

  // Data
  const {
    data: items,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = api.item.getAll.useInfiniteQuery(
    {
      limit: 10,
      ...getFilter(state),
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );
  const allItems = items?.pages.flatMap((page) => page.data);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutations
  const { mutate: create, isPending: load1 } = api.item.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
      router.push(`/manual/item/edit/${data.message}`);
    },
  });

  const { mutate: remove, isPending: load2 } = api.item.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  // Derived
  const totalLoading = isFetching || load1 || load2;

  return (
    <>
      <ContentBox
        title="Items"
        subtitle="Content"
        defaultBackHref="/manual"
        topRightContent={
          <div className="flex flex-row gap-1">
            <Link href="/manual/item/balance">
              <Button id="item-statistics" hoverText="Balance Statistics">
                <ChartCandlestick className="h-6 w-6" />
              </Button>
            </Link>
            <Link href="/manual/item/completeness">
              <Button id="item-completeness" hoverText="Content Completeness">
                <ChartPie className="h-6 w-6" />
              </Button>
            </Link>
          </div>
        }
      >
        <p>
          In the treacherous world of ninja warfare, the mastery of jutsu alone is not
          enough to ensure victory. To become a truly formidable force, ninjas must
          harness the power of a diverse array of tools, weapons, and armor. These
          essential implements are instrumental in enhancing their combat prowess,
          aiding their strategic maneuvers, and providing crucial defense in the face of
          danger.
        </p>
      </ContentBox>
      <br />
      <ContentBox
        title="Database"
        initialBreak={true}
        subtitle="All known items"
        topRightContent={
          <div className="items-center sm:flex sm:flex-row">
            {userData && canChangeContent(userData.role) && (
              <div className="flex flex-row gap-2">
                <Button
                  id={`create-${state.itemType}`}
                  className="w-full"
                  onClick={() =>
                    create({
                      type: state.itemType !== "ANY" ? state.itemType : "WEAPON",
                    })
                  }
                >
                  <FilePlus className="mr-2 h-6 w-6" />
                  New
                </Button>
                <Link href="/manual/item/mass_edit">
                  <Button id="mass-edit-items" className="w-full">
                    <ListChecks className="mr-2 h-6 w-6" />
                    Edit
                  </Button>
                </Link>
              </div>
            )}
            <div className="ml-2">
              <ItemFiltering state={state} />
            </div>
          </div>
        }
      >
        {totalLoading && <Loader explanation="Loading data" />}
        {allItems?.map((item, i) => (
          <div key={item.id} ref={i === allItems.length - 1 ? setLastElement : null}>
            <ItemWithEffects
              item={item}
              key={item.id}
              onDelete={(id: string) => remove({ id })}
              showEdit="item"
              showStatistic="item"
              showCopy="item"
            />
          </div>
        ))}
      </ContentBox>
    </>
  );
}
