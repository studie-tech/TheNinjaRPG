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
import { canDeleteStaffApplication } from "@/utils/permissions";

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
  const utils = api.useContext();
  const deleteMutation = api.applications.delete.useMutation({
    onSuccess: async () => {
      // Invalidate the exact list query with current filters for precision
      await utils.applications.list.invalidate({
        ...getApplicationsFilter(filterState),
        limit: 30,
      });
    },
  });

  if (!isStaff) {
    return (
      <ContentBox
        title="Applications"
        subtitle="Staff only"
        defaultBackHref="/manual/staff"
      >
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
    // Human-friendly vote text for table
    myVote: a.myVote ? (a.myVote === "APPROVED" ? "Approved" : "Rejected") : "Not voted",
    // Actions: delete button for CODING_ADMIN
    actions: (
      <div>
        {me && canDeleteStaffApplication(me.role) && (
          <button
            disabled={deleteMutation.isLoading}
            className={`text-red-600 hover:underline ${
              deleteMutation.isLoading ? "opacity-50 cursor-not-allowed" : ""
            }`}
            onClick={async (e) => {
              e.preventDefault();
              if (deleteMutation.isLoading) return;
              const ok = window.confirm("Delete this application? This cannot be undone.");
              if (!ok) return;
              try {
                await deleteMutation.mutateAsync({ id: a.id });
              } catch (err) {
                // swallow - optionally show toast
                // eslint-disable-next-line no-console
                console.error(err);
                alert("Failed to delete application");
              }
            }}
          >
            {deleteMutation.isLoading ? "Deleting..." : "Delete"}
          </button>
        )}
      </div>
    ),
  }));

  return (
    <ContentBox
      title="Applications"
      subtitle="Current staff applications"
      defaultBackHref="/manual/staff"
      padding={false}
      topRightContent={<ApplicationsFiltering state={filterState} />}
    >
      {isPending && <Loader explanation="Loading applications" />}
      {!isPending && rows.length === 0 && <p className="p-3">No applications found</p>}
      {!isPending && rows.length > 0 && (
        <Table
          data={rows}
          linkPrefix="/manual/staff/applications/"
          linkColumn={"id"}
          columns={[
            { key: "avatar", header: "", type: "avatar" } as any,
            { key: "info", header: "Info", type: "jsx" } as any,
            { key: "createdAt", header: "Created", type: "date" },
            { key: "myVote", header: "Your Vote", type: "string" },
            {
              key: "motivationPreview",
              header: "Motivation",
              type: "string",
              tooltip: (row) => (row as { motivation?: string }).motivation || "",
            },
            { key: "actions", header: "Actions", type: "jsx" } as any,
          ]}
          setLastElement={setLastElement}
        />
      )}
    </ContentBox>
  );
}
