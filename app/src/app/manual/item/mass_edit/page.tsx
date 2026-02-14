"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import { EffectFieldSelector, MassEffectEditor } from "@/layout/EditContent";
import ItemFiltering, { getFilter, useFiltering } from "@/layout/ItemFiltering";
import Loader from "@/layout/Loader";
import { useInfinitePagination } from "@/libs/pagination";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ItemMassEditPage() {
  const { data: userData } = useUserData();
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

  const [fields, setFields] = useState<string[]>([]);
  const canEdit = Boolean(userData && canChangeContent(userData.role));

  return (
    <>
      <ContentBox title="Mass Edit" subtitle="Items" defaultBackHref="/manual/item">
        <p>
          These tools are for efficient mass edit of content effects. Use the filter to
          find entries, select the effect fields to edit, then apply changes across many
          entries at once.
        </p>
      </ContentBox>
      <ContentBox
        title="Editor"
        subtitle="Select fields and edit"
        initialBreak
        topRightContent={
          <div className="flex items-center gap-2">
            <ItemFiltering state={state} />
            <EffectFieldSelector selected={fields} setSelected={setFields} />
          </div>
        }
        padding={false}
      >
        {!canEdit && <div className="p-3">Not allowed.</div>}
        {canEdit && isFetching && <Loader explanation="Loading data" />}
        {canEdit && (
          <div ref={setLastElement}>
            <MassEffectEditor
              kind="item"
              entries={allItems}
              selectedFields={fields}
              onEntriesUpdated={() => void refetch()}
            />
          </div>
        )}
      </ContentBox>
    </>
  );
}
