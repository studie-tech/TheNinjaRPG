"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { useInfinitePagination } from "@/libs/pagination";
import type { ArrayElement } from "@/utils/typeutils";
import type { ActionLogSchema } from "@/validators/logs";

interface ActionLogsProps {
  state: ActionLogSchema;
  defaultBackHref?: string;
  relatedId?: string;
  initialBreak?: boolean;
  topRightContent?: React.ReactNode;
}

const ActionLogs: React.FC<ActionLogsProps> = (props) => {
  // State
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Query
  const {
    data: entries,
    fetchNextPage,
    hasNextPage,
    isFetching,
  } = api.logs.getContentChanges.useInfiniteQuery(
    { limit: 50, relatedId: props.relatedId, ...props.state },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 1000 * 60 * 5, // every 5min
    },
  );
  const allEntries = entries?.pages
    .flatMap((page) => page.data)
    .map((entry) => {
      return {
        ...entry,
        username: entry?.user?.username,
        changes: (
          <div>
            <h3>{entry.relatedMsg}</h3>
            {entry.changes.length > 0 &&
              entry.changes.map((change, i) => {
                return <li key={`${change}-${i}`}>{change}</li>;
              })}
            {entry.changes.length === 0 && <li>No changes</li>}
            <p className="mt-2 font-bold italic">
              Changed at: {entry.createdAt.toLocaleString()} by{" "}
              {entry.user?.username ?? "Unknown"}
            </p>
          </div>
        ),
      };
    });

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  // Table definitions
  type Entry = ArrayElement<typeof allEntries>;
  const columns: ColumnDefinitionType<Entry, keyof Entry>[] = [
    { key: "relatedImage", header: "", type: "avatar" },
    { key: "changes", header: "Changes", type: "string" },
  ];

  return (
    <ContentBox
      title="Content Log"
      subtitle={`Changes for: ${props.state.logtype}`}
      padding={false}
      defaultBackHref={props.defaultBackHref}
      initialBreak={props.initialBreak}
      topRightContent={props.topRightContent}
    >
      {allEntries && (
        <Table
          data={allEntries}
          columns={columns}
          linkPrefix="/username/"
          linkColumn={"username"}
          setLastElement={setLastElement}
        />
      )}
      {isFetching && <Loader explanation="Loading data" />}
    </ContentBox>
  );
};

export default ActionLogs;
