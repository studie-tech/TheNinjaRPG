"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ItemWithEffects from "@/layout/ItemWithEffects";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import JutsuFiltering, { useFiltering, getFilter } from "@/layout/JutsuFiltering";
import { Button } from "@/components/ui/button";
import { FilePlus, ChartCandlestick, ChartPie } from "lucide-react";
import { useInfinitePagination } from "@/libs/pagination";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualJutsus() {
  // Settings
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Two-level filtering
  const state = useFiltering();

  // Router for forwarding
  const router = useRouter();

  // Get jutsus
  const {
    data: jutsus,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = api.jutsu.getAll.useInfiniteQuery(
    { limit: 10, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const alljutsus = jutsus?.pages.map((page) => page.data).flat();
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutations
  const { mutate: create, isPending: load1 } = api.jutsu.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
      router.push(`/manual/jutsu/edit/${data.message}`);
    },
  });

  const { mutate: remove, isPending: load2 } = api.jutsu.delete.useMutation({
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
        title="Jutsus"
        subtitle="What are they?"
        back_href="/manual"
        topRightContent={
          <div className="flex flex-row gap-1">
            <Link href="/manual/jutsu/balance">
              <Button id="jutsu-statistics" hoverText="Balance Statistics">
                <ChartCandlestick className="h-6 w-6" />
              </Button>
            </Link>
            <Link href="/manual/jutsu/completeness">
              <Button id="jutsu-completeness" hoverText="Content Completeness">
                <ChartPie className="h-6 w-6" />
              </Button>
            </Link>
          </div>
        }
      >
        <p>
          In the world of ninja battles, jutsu refers to the mystical skills and
          techniques that a ninja can use. These techniques require the ninja to harness
          their inner chakra energy, which is released through a series of hand
          movements known as hand seals. With countless combinations of hand seals and
          chakra energies, there are endless possibilities for the types of jutsu that
          can be created. Whether it is a technique for offence or defence, a skilled
          ninja must master the art of jutsu to become a true warrior.
        </p>
        <p className="pt-4">
          Jutsu can be trained at the training grounds in your village; here you can
          find multiple teachers, who will teach you how to advance your jutsu for a
          given price.
        </p>
      </ContentBox>
      <ContentBox
        title="Database"
        subtitle="All known jutsu"
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row gap-1 items-center">
            {userData && canChangeContent(userData.role) && (
              <>
                <Button id="create-jutsu" onClick={() => create()}>
                  <FilePlus className="sm:mr-2 h-6 w-6" />
                  <p className="hidden sm:block">New</p>
                </Button>
              </>
            )}
            <JutsuFiltering state={state} />
          </div>
        }
      >
        {totalLoading && <Loader explanation="Loading data" />}
        {alljutsus?.map((jutsu, i) => (
          <div key={i} ref={i === alljutsus.length - 1 ? setLastElement : null}>
            <ItemWithEffects
              item={jutsu}
              key={jutsu.id}
              onDelete={(id: string) => remove({ id })}
              showEdit="jutsu"
              showStatistic="jutsu"
            />
          </div>
        ))}
        {!totalLoading && alljutsus?.length === 0 && (
          <div>No jutsus found given the search criteria.</div>
        )}
      </ContentBox>
    </>
  );
}
