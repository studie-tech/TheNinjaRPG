import dynamic from "next/dynamic";
import type React from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";

const DisplayUserReport = dynamic(() => import("@/layout/UserReport"), {
  loading: () => <Loader explanation="Loading report" />,
});

const BanInfo: React.FC = () => {
  const { data: report } = api.reports.getBan.useQuery(undefined);

  if (!report?.reportedUser) return <Loader explanation="Loading ban info" />;

  return (
    <>
      <ContentBox
        title="No Access"
        subtitle="You are banned"
        defaultBackHref="/profile"
      >
        Please wait for your ban to end before you can access this page. If you need
        clarification or wish to ask a question, you can create a private support ticket
        to reach moderation.
      </ContentBox>
      <DisplayUserReport report={report} initialBreak={true} hideHrefBack={true} />
    </>
  );
};

export default BanInfo;
