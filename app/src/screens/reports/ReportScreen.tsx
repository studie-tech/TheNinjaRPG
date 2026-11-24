"use client";

import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import ParsedReportJson from "@/layout/ReportReason";
import DisplayUserReport from "@/layout/UserReport";
import { useRequiredUserData } from "@/utils/UserContext";

/** Render the reports screen independently of its route adapter. */
export function ReportScreen(props: { params: { reportid: string } }) {
  const params = props.params;
  const { data: userData } = useRequiredUserData();

  const report_id = params.reportid;

  const { data, isPending, isError } = api.reports.get.useQuery(
    { id: report_id },
    { enabled: !!report_id && !!userData },
  );
  const { report, prevReports } = data || {};

  if (!userData || isPending) {
    return <Loader explanation="Loading data..." />;
  }

  // A missing report and one this player cannot read both come back as null.
  // A failed query is already toasted by the client; this panel just stops the loader.
  if (!report) {
    return (
      <ContentBox
        title="Report"
        subtitle={
          isError ? "This report could not be opened" : "This report is not available"
        }
        defaultBackHref="/profile"
      >
        <p>
          {isError
            ? "This report could not be opened."
            : "This report is not available to you."}
        </p>
        <Link href="/profile" className="mt-2 inline-block hover:text-orange-700">
          Back to profile
        </Link>
      </ContentBox>
    );
  }

  return (
    <>
      <DisplayUserReport report={report} />
      {prevReports && prevReports.length > 0 && (
        <ContentBox
          title="Related Reports"
          subtitle="Previous moderation cases with similar content"
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
