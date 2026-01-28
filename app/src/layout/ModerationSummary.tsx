import React, { useRef, useEffect } from "react";
import { api } from "@/app/_trpc/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { Chart as ChartJS } from "chart.js/auto";
import type { ChartTypeRegistry, TooltipItem } from "chart.js/auto";

interface ModerationSummaryProps {
  userId?: string;
  trigger: React.ReactNode;
}

export const ModerationSummary: React.FC<ModerationSummaryProps> = ({
  userId,
  trigger,
}) => {
  const [open, setOpen] = React.useState(false);
  const { data, isLoading } = api.reports.getUserModerationSummary.useQuery(
    { userId },
    { enabled: open },
  );

  // Chart reference
  const categoryChartRef = useRef<HTMLCanvasElement>(null);

  // Chart instance for cleanup
  const chartInstanceRef = useRef<ChartJS<keyof ChartTypeRegistry> | null>(null);

  // Format data for category chart - filter out totalEntries and only include categories with values > 0
  const categoryChartData = data
    ? Object.entries(data[0] || {})
        .filter(([key, value]) => key !== "totalEntries" && Number(value) > 0)
        .map(([category, count]) => ({
          category: formatCategoryName(category),
          count: Number(count),
        }))
        .sort((a, b) => b.count - a.count)
    : [];

  // Function to create or update the chart
  const createOrUpdateChart = () => {
    if (!data || !categoryChartRef.current || categoryChartData.length === 0) return;

    // Clean up previous chart instance
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const ctx = categoryChartRef.current.getContext("2d");
    if (ctx) {
      chartInstanceRef.current = new ChartJS(ctx, {
        type: "bar",
        data: {
          labels: categoryChartData.map((item) => item.category),
          datasets: [
            {
              label: "Count",
              data: categoryChartData.map((item) => item.count),
              backgroundColor: "rgba(234, 88, 12, 0.7)",
              borderColor: "rgba(234, 88, 12, 1)",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                label: function (tooltipItem: TooltipItem<"bar">) {
                  return `Count: ${tooltipItem.formattedValue}`;
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                precision: 0,
              },
            },
          },
        },
      });
    }
  };

  // Effect to handle chart creation/destruction based on data changes
  useEffect(() => {
    if (data) {
      // We'll create the chart when data is available, but only render it when dialog is open
      createOrUpdateChart();
    }

    // Cleanup function
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, categoryChartData]);

  // Effect to handle dialog open/close
  useEffect(() => {
    if (open) {
      // When dialog opens, ensure chart is created if we have data
      const timeoutId = setTimeout(() => {
        createOrUpdateChart();
      }, 100); // Small delay to ensure the canvas is visible
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalEntries = data?.[0]?.totalEntries || 0;
  const categoriesWithFlags = categoryChartData.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Content Moderation Summary</DialogTitle>
          <DialogDescription>
            This shows an overview of content moderation flags on your account
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <p>Loading moderation data...</p>
          </div>
        ) : !data || totalEntries === 0 ? (
          <div className="flex flex-col justify-center items-center h-64">
            <p className="text-green-600 font-semibold mb-2">
              No moderation flags found
            </p>
            <p className="text-gray-500 text-sm text-center">
              Your content hasn&apos;t triggered any automated moderation flags.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Moderation Summary</CardTitle>
                <CardDescription>Overview of moderation flags</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Total flags:</span>
                    <span className="font-semibold">{totalEntries}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Categories flagged:</span>
                    <span className="font-semibold">{categoriesWithFlags}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Moderation Categories</CardTitle>
                <CardDescription>
                  Distribution of moderation flags by category
                </CardDescription>
              </CardHeader>
              <CardContent>
                {categoryChartData.length > 0 ? (
                  <div className="h-80">
                    <canvas ref={categoryChartRef} />
                  </div>
                ) : (
                  <p className="text-center text-gray-500 py-8">
                    No category data available
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="p-4 bg-orange-50 border border-orange-200 rounded-md flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-orange-800">
                  Understanding Your Moderation Data
                </h4>
                <p className="text-sm text-orange-700 mt-1">
                  Content moderation is performed automatically to ensure community
                  guidelines are followed. If you notice a pattern of flags, consider
                  reviewing our community guidelines. Flags older than 3 months are
                  automatically deleted.
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// Helper function to format category names for display
const formatCategoryName = (category: string): string => {
  return category
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};
