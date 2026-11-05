import dynamic from "next/dynamic";
import type React from "react";
import { Button } from "@/components/ui/button";
import Loader from "@/layout/Loader";
import { getUnique } from "@/utils/grouping";

/**
 * cytoscape is over a megabyte of source for a graph that only appears once someone asks
 * for it, so the boundary sits here rather than at the page: every consumer gets the
 * deferral.
 */
export const LazyGraphUsers = dynamic(() => import("@/layout/GraphUsersGeneric"), {
  ssr: false,
  loading: () => <Loader explanation="Loading graph" />,
});

/**
 * Loading, retryable failure and empty states around a graph query. `children` renders the
 * rows once they are in and there is at least one.
 */
export const GraphQueryState = <Row,>(props: GraphQueryStateProps<Row>) => {
  const { data, isPending, isFetching, refetch } = props.query;
  if (!data) {
    if (isPending) return <Loader explanation={props.loadingText} />;
    return (
      <div role="alert" className="space-y-2 py-2">
        <p>{props.errorText}</p>
        <Button type="button" onClick={() => void refetch()} disabled={isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (data.length === 0) return <p role="status">{props.emptyText}</p>;
  return props.children(data);
};

/** Distinct graph nodes for the users `pick` names on each row. */
export const toGraphNodes = <Row,>(rows: Row[], pick: (row: Row) => GraphNode[]) =>
  getUnique(rows.flatMap(pick), "id");

type GraphNode = { id: string; label: string; img: string | null };

interface GraphQueryStateProps<Row> {
  query: {
    data: Row[] | undefined;
    isPending: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
  loadingText: string;
  errorText: string;
  emptyText: string;
  children: (rows: Row[]) => React.ReactNode;
}
