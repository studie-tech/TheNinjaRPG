"use client";

import { use } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import ParsedReportJson from "@/layout/ReportReason";
import DisplayUserReport from "@/layout/UserReport";
import { REPORT_ACCESS_DENIED_MESSAGE } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Report(props: { params: Promise<{ reportid: string }> }) {
  const params = use(props.params);
  const { data: userData } = useRequiredUserData();

  const report_id = params.reportid;

  const { data, isError, error } = api.reports.get.useQuery(
    { id: report_id },
    { enabled: !!report_id && !!userData },
  );
  const { report, prevReports } = data || {};

  if (!userData) {
    return <Loader explanation="Loading data..." />;
  }

  if (!isError && !report) {
    return <Loader explanation="Loading data..." />;
  }

  // Access denial is an expected outcome. Show the server message and a way back
  // instead of leaving the loader up after the query has failed.
  if (isError || !report) {
    return (
      <ContentBox
        title="Report"
        subtitle="This report could not be opened"
        defaultBackHref="/profile"
      >
        {error?.message ?? REPORT_ACCESS_DENIED_MESSAGE}
      </ContentBox>
    );
  }

  return (
    <>
      <DisplayUserReport report={report} />
      {prevReports && prevReports.length > 0 && (
        <ContentBox
          title="Related Reports"
          subtitle="Note: Search will be improved once Vector Search is available"
          initialBreak
        >
          {prevReports?.map((report) => (
            <Link href={`/reports/${report.id}`} key={report.id}>
              <Post hover_effect={true}>
                <div className="p-2">
                  <ParsedReportJson report={report} viewer={userData} />
                  <b>Current status:</b> {report.status}
                </div>
              </Post>
            </Link>
          ))}
        </ContentBox>
      )}
    </>
  );
}
