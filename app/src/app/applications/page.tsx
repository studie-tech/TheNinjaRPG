"use client";

import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { api } from "@/app/_trpc/client";
import { useUserData } from "@/utils/UserContext";
import Table from "@/layout/Table";
import { useState } from "react";
import { useInfinitePagination } from "@/libs/pagination";
import ApplicationsFiltering, {
  getApplicationsFilter,
  useApplicationsFiltering,
} from "@/layout/ApplicationsFiltering";

export default function ApplicationsPage() {
  const { data: me } = useUserData();
  const isStaff = me?.role && me.role !== "USER";
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const filterState = useApplicationsFiltering();
  const {
    data: appsPages,
    fetchNextPage,
    hasNextPage,
    isPending,
  } = api.applications.list.useInfiniteQuery(
    { ...getApplicationsFilter(filterState), limit: 30 },
    {
      enabled: Boolean(isStaff),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      staleTime: 1000 * 60 * 5,
    },
  );
  const apps = appsPages?.pages.map((p) => p.data).flat();
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  if (!isStaff) {
    return (
      <ContentBox title="Applications" subtitle="Staff only" defaultBackHref="/staff">
        You do not have access to this page.
      </ContentBox>
    );
  }

  const rows = (apps || []).map((a) => ({
    ...a,
    avatar: a.applicant?.avatar || "",
    info: (
      <div>
        <p className="font-bold">{a.applicant?.username}</p>
        <p>
          Target: {a.targetRole} • Status: {a.state.toLowerCase()}
        </p>
        <p>
          Lvl. {a.applicant?.level || 0} {a.applicant?.rank || "STUDENT"}
        </p>
        <p>{a.applicant?.village?.name || "Syndicate"}</p>
      </div>
    ),
    motivationPreview:
      (a.motivation || "").length > 140
        ? `${a.motivation?.slice(0, 140)}…`
        : a.motivation || "",
  }));

  return (
    <ContentBox
      title="Applications"
      subtitle="Current staff applications"
      defaultBackHref="/staff"
      padding={false}
      topRightContent={<ApplicationsFiltering state={filterState} />}
    >
      {isPending && <Loader explanation="Loading applications" />}
      {!isPending && rows.length === 0 && <p className="p-3">No applications found</p>}
      {!isPending && rows.length > 0 && (
        <Table
          data={rows}
          linkPrefix="/applications/"
          linkColumn={"id"}
          columns={[
            { key: "avatar", header: "", type: "avatar" } as any,
            { key: "info", header: "Info", type: "jsx" } as any,
            { key: "createdAt", header: "Created", type: "date" },
            {
              key: "motivationPreview",
              header: "Motivation",
              type: "string",
              tooltip: (row) => (row as { motivation?: string }).motivation || "",
            },
          ]}
          setLastElement={setLastElement}
        />
      )}
    </ContentBox>
  );
}
