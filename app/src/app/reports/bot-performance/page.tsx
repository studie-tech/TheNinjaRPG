"use client";

import { Chart as ChartJS } from "chart.js/auto";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import Toggle from "@/components/control/Toggle";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { groupBy } from "@/utils/grouping";
import { useRequiredUserData } from "@/utils/UserContext";

export default function BotPerformance() {
  // State
  const { data: userData } = useRequiredUserData();
  const [showTotals, setShowTotals] = useState<boolean | undefined>(false);
  const [showWeekly, setShowWeekly] = useState<boolean | undefined>(false);
  const timeframe = showWeekly ? "weekly" : "daily";

  // Charting
  const botChartRef = useRef<HTMLCanvasElement>(null);

  // Query
  const { data, isFetching } = api.reports.getModBotPerformance.useQuery(
    { timeframe },
    { enabled: !!userData && userData.role !== "USER" },
  );
  const totalUserReports = data?.totalUserReports;
  const totalBotReports = data?.totalBotReports;
  const botReports = data?.botReports;

  useEffect(() => {
    const xSorter = (a: { x: number }, b: { x: number }) => {
      return a.x - b.x;
    };
    const groupCount = (acc: number, curr: NonNullable<typeof botReports>[number]) => {
      return acc + curr.count;
    };
    const classCtx = botChartRef?.current?.getContext("2d");
    if (classCtx && totalUserReports && totalBotReports && botReports) {
      // Overall number of reports
      const labels = [
        ...new Set([...totalUserReports, ...totalBotReports].map((r) => r.time)),
      ].sort();
      const usersOverall = totalUserReports
        .map((report) => ({ x: report.time, y: report.count }))
        .sort(xSorter);
      const botsOverall = totalBotReports
        .map((report) => ({ x: report.time, y: report.count }))
        .sort(xSorter);
      // Bot accuracy rates
      const groups = groupBy(botReports, "time");
      const truePositives = labels
        .map((time) => {
          const group = groups.get(time);
          const count = group?.reduce(groupCount, 0) || 1;
          const pos =
            group
              ?.filter(
                (r) =>
                  r.status !== "REPORT_CLEARED" &&
                  r.predictedStatus !== "REPORT_CLEARED",
              )
              .reduce(groupCount, 0) || 0;
          return { x: time, y: pos / count };
        })
        .sort(xSorter);
      const falsePositives = labels
        .map((time) => {
          const group = groups.get(time);
          const count = group?.reduce((acc, curr) => acc + curr.count, 0) || 1;
          const neg =
            group
              ?.filter(
                (r) =>
                  r.status === "REPORT_CLEARED" &&
                  r.predictedStatus === "REPORT_CLEARED",
              )
              .reduce(groupCount, 0) || 0;
          return { x: time, y: neg / count };
        })
        .sort(xSorter);
      const falseNegatives = labels
        .map((time) => {
          const userTotal = usersOverall.find((r) => r.x === time)?.y || 1;
          const botTotal = botsOverall.find((r) => r.x === time)?.y || 0;
          return { x: time, y: userTotal / (userTotal + botTotal) };
        })
        .sort(xSorter);

      // Chart
      const myClassChart = new ChartJS(classCtx, {
        type: "line",
        options: {
          maintainAspectRatio: false,
          responsive: true,
          aspectRatio: 1.1,
          scales: {
            y: {
              beginAtZero: true,
            },
            x: {
              title: {
                display: true,
                text: "Week",
              },
            },
          },
        },
        data: {
          labels,
          datasets: [
            ...(showTotals
              ? [
                  { data: usersOverall, borderWidth: 1, label: "User Reports" },
                  { data: botsOverall, borderWidth: 1, label: "Bot Reports" },
                ]
              : []),
            ...(!showTotals
              ? [
                  {
                    data: truePositives,
                    borderWidth: 1,
                    label: "True Positive",
                    borderColor: "rgb(0, 192, 0)",
                  },
                  {
                    data: falsePositives,
                    borderWidth: 1,
                    label: "False Positive",
                    borderColor: "rgb(192, 0, 0)",
                  },
                  {
                    data: falseNegatives,
                    borderWidth: 1,
                    label: "False Negatives",
                    borderColor: "rgb(0, 0, 192)",
                  },
                ]
              : []),
          ],
        },
      });
      // Remove on unmount
      return () => {
        myClassChart.destroy();
      };
    }
  }, [totalUserReports, totalBotReports, showTotals, botReports, isFetching]);

  // Render
  return (
    <ContentBox
      title="Bot Performance"
      subtitle="Accuracy over time"
      defaultBackHref="/reports"
      padding={false}
      topRightContent={
        <div>
          <Toggle
            id="toggle-damage-simulator"
            value={showTotals}
            setShowActive={setShowTotals}
            labelActive="Totals"
            labelInactive="Performance"
          />
          <Toggle
            id="toggle-weekly"
            value={showWeekly}
            setShowActive={setShowWeekly}
            labelActive="Weekly"
            labelInactive="Daily"
          />{" "}
        </div>
      }
    >
      {!userData && <Loader explanation="Loading userdata" />}
      {isFetching && userData && <Loader explanation="Loading statistics" />}
      {!userData && !isFetching && !data && <Loader explanation="No access" />}
      <div className="relative w-[99%] p-3">
        <canvas ref={botChartRef} id="botPerformance"></canvas>
      </div>
    </ContentBox>
  );
}
