"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuFiltering, { getFilter, useFiltering } from "@/layout/JutsuFiltering";
import ListLoader from "@/layout/ListLoader";
import { useInfinitePagination } from "@/libs/pagination";

export default function ManualJutsuReskins() {
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Two-level filtering
  const state = useFiltering();

  // Get reskinned jutsus
  const {
    data: reskins,
    isFetching,
    isPending,
    fetchNextPage,
    hasNextPage,
  } = api.jutsu.getAllReskins.useInfiniteQuery(
    { limit: 10, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allReskins = reskins?.pages.flatMap((page) => page.data);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Transform reskin data to jutsu-like objects for ItemWithEffects. Reskins whose
  // base jutsu was deleted have no mechanics to show; staff re-point them from the
  // edit page.
  const transformedReskins = allReskins?.map((reskin) => {
    const cosmetics = {
      id: reskin.id,
      name: reskin.name,
      description: reskin.description,
      createdAt: reskin.createdAt,
      updatedAt: reskin.updatedAt,
      createdBy: reskin.user.username,
    };
    if (!reskin.jutsu) {
      return { item: { ...cosmetics, image: reskin.image }, isOrphaned: true };
    }
    return {
      item: {
        ...reskin.jutsu,
        ...cosmetics,
        battleDescription: reskin.battleDescription,
        originalJutsuName: reskin.jutsu.name,
        isReskin: true,
      },
      isOrphaned: false,
    };
  });

  return (
    <>
      <ContentBox
        title="Jutsu Reskins"
        subtitle="Community Customizations"
        defaultBackHref="/manual/jutsu"
      >
        <p>
          Jutsu reskins are customizations created by players to personalize their
          jutsu&apos;s name, description, and battle text. These are purely cosmetic
          changes that allow players to express their creativity while maintaining the
          original jutsu&apos;s mechanics and balance.
        </p>
        <p className="pt-4">
          Below you can browse all the reskins created by the community. Each reskin
          shows the custom name, description, and battle text while preserving the
          original jutsu&apos;s mechanics and effects.
        </p>
      </ContentBox>
      <ContentBox
        title="Database"
        subtitle="All custom jutsu reskins"
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row items-center gap-1">
            <JutsuFiltering state={state} />
          </div>
        }
      >
        {transformedReskins?.map(({ item, isOrphaned }, i) => (
          <div
            key={item.id}
            ref={i === transformedReskins.length - 1 ? setLastElement : null}
          >
            <ItemWithEffects
              item={item}
              showEdit="jutsu/reskins"
              notice={
                isOrphaned && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Orphaned: the base jutsu of this reskin was deleted. Edit it to
                      assign another base jutsu.
                    </AlertDescription>
                  </Alert>
                )
              }
            />
          </div>
        ))}
        {!isFetching && transformedReskins?.length === 0 && (
          <div>No reskins found given the search criteria.</div>
        )}
        <ListLoader
          initialLoading={isPending}
          loading={isFetching}
          explanation="Loading data"
        />
      </ContentBox>
    </>
  );
}
