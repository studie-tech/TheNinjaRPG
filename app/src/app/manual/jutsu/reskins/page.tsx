"use client";

import { useState } from "react";
import ItemWithEffects from "@/layout/ItemWithEffects";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import JutsuFiltering, { useFiltering, getFilter } from "@/layout/JutsuFiltering";
import { useInfinitePagination } from "@/libs/pagination";
import { api } from "@/app/_trpc/client";

export default function ManualJutsuReskins() {
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Two-level filtering
  const state = useFiltering();

  // Get reskinned jutsus
  const {
    data: reskins,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = api.jutsu.getAllReskins.useInfiniteQuery(
    { limit: 10, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allReskins = reskins?.pages.map((page) => page.data).flat();
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Transform reskin data to jutsu-like objects for ItemWithEffects
  const transformedReskins = allReskins?.map((reskin) => ({
    ...reskin.jutsu,
    id: reskin.id,
    name: reskin.name,
    description: reskin.description,
    battleDescription: reskin.battleDescription,
    createdAt: reskin.createdAt,
    updatedAt: reskin.updatedAt,
    createdBy: reskin.user.username,
    originalJutsuName: reskin.jutsu.name,
    isReskin: true,
  }));

  const totalLoading = isFetching;

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
          <div className="flex flex-row gap-1 items-center">
            <JutsuFiltering state={state} />
          </div>
        }
      >
        {totalLoading && <Loader explanation="Loading data" />}
        {transformedReskins?.map((reskin, i) => (
          <div
            key={reskin.id}
            ref={i === transformedReskins.length - 1 ? setLastElement : null}
          >
            <ItemWithEffects item={reskin} showEdit="jutsu/reskins" />
          </div>
        ))}
        {!totalLoading && transformedReskins?.length === 0 && (
          <div>No reskins found given the search criteria.</div>
        )}
      </ContentBox>
    </>
  );
}
