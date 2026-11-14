"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { useInfinitePagination } from "@/libs/pagination";
import { parseContentChange } from "@/utils/diff";
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
        author: entry.user?.username ?? "Unknown",
        image: entry.relatedImage ? (
          <div className="w-20">
            <AvatarImage
              href={entry.relatedImage}
              alt={entry.relatedMsg ?? undefined}
              size={100}
              hover_effect={true}
            />
          </div>
        ) : null,
        changes: (
          <div>
            <h3 className="font-bold">{entry.relatedMsg}</h3>
            {entry.changes.length > 0 ? (
              <ul>
                {entry.changes.map((change, i) => (
                  <ContentChange key={`${change}-${i}`} change={change} />
                ))}
              </ul>
            ) : (
              <p className="italic">No changes</p>
            )}
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
    { key: "image", header: "", type: "jsx", className: "hidden sm:table-cell" },
    { key: "changes", header: "Changes", type: "jsx" },
    { key: "createdAt", header: "Date", type: "date" },
    { key: "author", header: "By", type: "string" },
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

/** Changed fields shown before the rest of a long change collapses behind a toggle. */
const VISIBLE_CHANGE_FIELDS = 6;

/** One logged change, as field-level lines when it is a content diff and as text otherwise. */
const ContentChange: React.FC<{ change: string }> = ({ change }) => {
  const [showAll, setShowAll] = useState(false);
  const parsed = parseContentChange(change);
  if (!parsed) return <li className="break-all">{change}</li>;
  const hiddenCount = Math.max(0, parsed.fields.length - VISIBLE_CHANGE_FIELDS);
  const visible = showAll
    ? parsed.fields
    : parsed.fields.slice(0, VISIBLE_CHANGE_FIELDS);
  return (
    <li className="mt-1">
      <span className="font-semibold">{parsed.kind}</span>
      <ul className="ml-3">
        {visible.map((field) => (
          <ChangeField key={field.path} {...field} />
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="ml-3 text-muted-foreground underline"
          onClick={(e) => {
            // The surrounding row opens the author's profile.
            e.stopPropagation();
            setShowAll((current) => !current);
          }}
        >
          {showAll ? "Show fewer" : `Show ${hiddenCount} more`}
        </button>
      )}
    </li>
  );
};

/** Render one audited field, distinguishing removal from an empty value. */
const ChangeField: React.FC<{ path: string; value: string | undefined }> = (props) => (
  <li className="break-all">
    <code className="text-muted-foreground">{props.path}</code>
    {props.value === undefined ? " removed" : `: ${props.value}`}
  </li>
);
