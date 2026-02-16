"use client";

import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Reports() {
  const { data: userData } = useRequiredUserData();

  const { data, isFetching } = api.reports.getReportStatistics.useQuery(undefined, {
    enabled: !!userData && userData.role !== "USER",
  });

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isFetching) return <Loader explanation="Loading statistics" />;
  if (!data) return <Loader explanation="No access" />;

  // Wrangle a little bit
  const { staff, timesReported, timesReporting, decisions } = data;
  const processed = staff
    .map((member) => {
      const rFrom = timesReported.find((r) => r.userId === member.userId)?.count || 0;
      const rTo = timesReporting.find((r) => r.userId === member.userId)?.count || 0;
      const mDecisions = decisions.filter((d) => d.userId === member.userId);
      return {
        ...member,
        timesReported: rFrom,
        timesReporting: rTo,
        warnings: mDecisions.find((d) => d.decision === "OFFICIAL_WARNING")?.count || 0,
        silences:
          mDecisions.find((d) => d.decision === "SILENCE_ACTIVATED")?.count || 0,
        timeouts:
          mDecisions.find((d) => d.decision === "TIMEOUT_ACTIVATED")?.count || 0,
        bans: mDecisions.find((d) => d.decision === "BAN_ACTIVATED")?.count || 0,
        cleared: mDecisions.find((d) => d.decision === "REPORT_CLEARED")?.count || 0,
      };
    })
    .sort((a, b) => b.timesReported - a.timesReported);

  // Table
  type Row = ArrayElement<typeof processed>;
  const columns: ColumnDefinitionType<Row, keyof Row>[] = [
    { key: "avatar", header: "", type: "avatar" },
    { key: "username", header: "Username", type: "string" },
    { key: "timesReported", header: "#Reported", type: "string" },
    { key: "timesReporting", header: "#Reports", type: "string" },
    { key: "warnings", header: "#Warnings", type: "string" },
    { key: "silences", header: "#Silences", type: "string" },
    { key: "timeouts", header: "#Timeouts", type: "string" },
    { key: "bans", header: "#Bans", type: "string" },
    { key: "cleared", header: "#Clears", type: "string" },
  ];

  return (
    <ContentBox
      title="Reports"
      subtitle={userData?.role === "USER" ? "Your reports" : "Overview"}
      defaultBackHref="/reports"
      padding={false}
    >
      <Table
        data={processed}
        columns={columns}
        linkPrefix="/username/"
        linkColumn={"username"}
      />
    </ContentBox>
  );
}
