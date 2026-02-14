import type React from "react";
import Image from "@/layout/Image";
import type { UserWithRelations } from "@/routers/profile";
import { parseHtml } from "@/utils/parse";
import { canSeeSecretData } from "@/utils/permissions";
import type { UserReport } from "../../drizzle/schema";

type InfractionData = {
  title?: string;
  summary?: string;
  content?: string;
  image?: string;
};

const ParsedReportJson: React.FC<{
  report: Omit<UserReport, "reporterUserId">;
  viewer: NonNullable<UserWithRelations>;
}> = (props) => {
  const infraction = props.report.infraction as InfractionData | null;
  return (
    <div>
      <b>Report Reason:</b> {parseHtml(props.report.reason)}
      <br />
      {infraction?.title && (
        <div className="py-5">
          <b>Reported Title:</b>
          <hr />
          {parseHtml(infraction.title)}
          <br />
          <br />
        </div>
      )}
      {infraction?.summary && (
        <div className="py-5">
          <b>Reported Summary:</b>
          <hr />
          {parseHtml(infraction.summary)}
          <br />
          <br />
        </div>
      )}
      {infraction?.content && (
        <div className="py-5">
          <b>Reported Content:</b>
          <hr />
          {parseHtml(infraction.content)}
        </div>
      )}
      {props.report.aiInterpretation && (
        <div className="py-5">
          <b>AI Interpretation:</b>
          <hr />
          {props.report.aiInterpretation}
          {canSeeSecretData(props.viewer.role) && (
            <div>
              <b>AI Prediction:</b> {props.report.predictedStatus}
            </div>
          )}
        </div>
      )}
      {infraction?.image && (
        <div className="py-5">
          <b>Image:</b>
          <hr />
          <Image
            src={infraction.image}
            width={100}
            className="w-full"
            alt="ReportingImage"
          />
        </div>
      )}
      <b>System:</b> {props.report.system}
      <br />
      <b>Report time</b> {props.report.createdAt.toLocaleString()}
      <br />
      <b>Report ID</b> {props.report.id}
    </div>
  );
};

export default ParsedReportJson;
