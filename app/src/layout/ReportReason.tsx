import React from "react";
import Image from "next/image";
import type { UserReport } from "../../drizzle/schema";
import { parseHtml } from "@/utils/parse";
import { canSeeSecretData } from "@/utils/permissions";
import type { UserWithRelations } from "@/routers/profile";

const ParsedReportJson: React.FC<{
  report: Omit<UserReport, "reporterUserId">;
  viewer: NonNullable<UserWithRelations>;
}> = (props) => {
  return (
    <div>
      <b>Report Reason:</b> {parseHtml(props.report.reason)}
      <br />
      {props.report.infraction?.hasOwnProperty("title") && (
        <div className="py-5">
          <b>Reported Title:</b>
          <hr />
          {parseHtml((props.report.infraction as { title: string }).title)}
          <br />
          <br />
        </div>
      )}
      {props.report.infraction?.hasOwnProperty("summary") && (
        <div className="py-5">
          <b>Reported Summary:</b>
          <hr />
          {parseHtml((props.report.infraction as { summary: string }).summary)}
          <br />
          <br />
        </div>
      )}
      {props.report.infraction?.hasOwnProperty("content") && (
        <div className="py-5">
          <b>Reported Content:</b>
          <hr />
          {parseHtml((props.report.infraction as { content: string }).content)}
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
      {props.report.infraction?.hasOwnProperty("image") && (
        <div className="py-5">
          <b>Image:</b>
          <hr />
          <Image
            src={(props.report.infraction as { image: string }).image}
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
