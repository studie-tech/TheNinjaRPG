"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import ItemFiltering, { getFilter, useFiltering } from "@/layout/ItemFiltering";
import { MassEffectEditorPage } from "@/layout/MassEffectEditorPage";
import { useInfinitePagination } from "@/libs/pagination";

export default function ItemMassEditPage() {
  const state = useFiltering();

  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const {
    data: items,
    isFetching,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = api.item.getAll.useInfiniteQuery(
    { limit: 50, ...getFilter(state) },
    {
      getNextPageParam: (last) => last.nextCursor,
      placeholderData: (p) => p,
    },
  );
  const allItems = items?.pages.flatMap((p) => p.data) || [];
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  return (
    <MassEffectEditorPage
      kind="item"
      subtitle="Items"
      defaultBackHref="/manual/item"
      entries={allItems}
      isFetching={isFetching}
      lastElementRef={setLastElement}
      onEntriesUpdated={() => refetch()}
      renderFilter={(disabled) => <ItemFiltering state={state} disabled={disabled} />}
      filterEffectTypes={state.effect}
    />
  );
}
