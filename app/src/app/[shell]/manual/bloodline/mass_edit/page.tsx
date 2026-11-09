"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import BloodFiltering, { getFilter, useFiltering } from "@/layout/BloodlineFiltering";
import { MassEffectEditorPage } from "@/layout/MassEffectEditorPage";
import { useInfinitePagination } from "@/libs/pagination";

export default function BloodlineMassEditPage() {
  const state = useFiltering();

  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const {
    data: bloodlines,
    isFetching,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = api.bloodline.getAll.useInfiniteQuery(
    { limit: 50, ...getFilter(state) },
    {
      getNextPageParam: (last) => last.nextCursor,
      placeholderData: (p) => p,
    },
  );
  const allBloodlines = bloodlines?.pages.flatMap((p) => p.data) || [];
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  return (
    <MassEffectEditorPage
      kind="bloodline"
      subtitle="Bloodlines"
      defaultBackHref="/manual/bloodline"
      entries={allBloodlines}
      isFetching={isFetching}
      lastElementRef={setLastElement}
      onEntriesUpdated={() => refetch()}
      renderFilter={(disabled) => <BloodFiltering state={state} disabled={disabled} />}
      filterEffectTypes={state.effect}
    />
  );
}
