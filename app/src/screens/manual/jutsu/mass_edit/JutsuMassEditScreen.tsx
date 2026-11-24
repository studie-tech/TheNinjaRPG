"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import JutsuFiltering, { getFilter, useFiltering } from "@/layout/JutsuFiltering";
import { MassEffectEditorPage } from "@/layout/MassEffectEditorPage";
import { useInfinitePagination } from "@/libs/pagination";

/** Render the manual jutsu mass_edit screen independently of its route adapter. */
export function JutsuMassEditScreen() {
  const state = useFiltering();

  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const {
    data: jutsus,
    isFetching,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = api.jutsu.getAll.useInfiniteQuery(
    { limit: 50, ...getFilter(state) },
    {
      getNextPageParam: (last) => last.nextCursor,
      placeholderData: (p) => p,
    },
  );
  const allJutsus = jutsus?.pages.flatMap((p) => p.data) || [];
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  return (
    <MassEffectEditorPage
      kind="jutsu"
      subtitle="Jutsu"
      defaultBackHref="/manual/jutsu"
      entries={allJutsus}
      isFetching={isFetching}
      lastElementRef={setLastElement}
      onEntriesUpdated={() => refetch()}
      renderFilter={(disabled) => <JutsuFiltering state={state} disabled={disabled} />}
      filterEffectTypes={state.effect}
    />
  );
}
