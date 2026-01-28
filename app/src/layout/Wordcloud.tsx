"use client";

import React, { useRef, useEffect } from "react";
import { Chart as ChartJS, registerables } from "chart.js";
import { WordCloudController, WordElement } from "chartjs-chart-wordcloud";
import type { ChartData, ChartOptions } from "chart.js";

// Register Chart.js components and word cloud elements
ChartJS.register(...registerables, WordCloudController, WordElement);

interface WordCloudProps {
  text: string | undefined;
}

const WordCloud: React.FC<WordCloudProps> = (props) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<ChartJS | null>(null);

  // Reduce to word frequency
  const stopWords = [
    "and",
    "the",
    "of",
    "in",
    "with",
    "their",
    "they",
    "to",
    "a",
    "is",
    "for",
    "her",
    "him",
    "by",
    "through",
    "into",
    "that",
    "this",
    "them",
    "as",
    "these",
    "from",
    "who",
    "its",
    "within",
    "an",
    "p",
    "are",
    "his",
    "on",
    "at",
    "be",
    "or",
    "it",
    "s",
    "was",
    "which",
    "will",
    "have",
    "has",
    "not",
    "but",
    "also",
    "can",
    "could",
    "would",
    "should",
    "may",
    "might",
    "shall",
    "must",
    "do",
    "does",
    "did",
    "done",
    "doing",
    "am",
    "are",
    "is",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "will",
    "would",
    "shall",
    "should",
    "may",
    "might",
    "must",
    "can",
    "could",
    "do",
    "does",
    "did",
    "doing",
    "a",
    "an",
    "the",
    "and",
    "but",
    "if",
    "or",
    "because",
    "as",
    "until",
    "while",
    "of",
    "at",
    "by",
    "for",
    "with",
    "about",
    "against",
    "between",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "to",
    "from",
    "up",
    "down",
    "in",
    "out",
    "on",
    "off",
    "over",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "any",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "s",
    "t",
    "can",
    "will",
    "just",
    "don",
    "should",
    "now",
    "d",
    "ll",
    "m",
    "o",
    "re",
    "ve",
    "y",
    "ain",
    "aren",
    "couldn",
    "didn",
    "doesn",
    "hadn",
    "hasn",
    "haven",
    "isn",
    "ma",
    "mightn",
    "mustn",
    "needn",
    "shan",
    "shouldn",
    "wasn",
    "weren",
    "won",
    "wouldn",
    "i",
    "me",
    "my",
    "myself",
    "we",
    "our",
    "ours",
    "ourselves",
    "you",
    "your",
    "new",
    "user",
    "opponent",
    "enemy",
    "description",
    "target",
    "jutsu",
  ];

  // Process text to create word frequency data
  const processedData = React.useMemo(() => {
    if (!props.text) return { labels: [], data: [] };

    const wordCounts = props.text
      .split(" ")
      .map((token) => token.toLowerCase().replace(/[^\w\s]/g, ""))
      .filter((token) => !stopWords.includes(token) && token.length > 0)
      .reduce<Record<string, number>>((acc, curr) => {
        acc[curr] = (acc[curr] || 0) + 1;
        return acc;
      }, {});

    const words = Object.entries(wordCounts)
      .map(([text, value]) => ({ text, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 50); // Limit to top 50 words for better performance

    return {
      labels: words.map((word) => word.text),
      data: words.map((word) => word.value),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.text]);

  // Function to create or update the chart
  const createOrUpdateChart = () => {
    if (!chartRef.current || processedData.labels.length === 0) {
      return;
    }

    // Clean up previous chart instance
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const ctx = chartRef.current.getContext("2d");
    if (ctx) {
      // Prepare chart data
      const chartConfig: ChartData = {
        labels: processedData.labels,
        datasets: [
          {
            label: "Word Frequency",
            data: processedData.data,
          },
        ],
      };

      // Chart options
      const options: ChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                return `${context.label}: ${String(context.raw)}`;
              },
            },
          },
        },
      };

      try {
        // Create new chart
        chartInstanceRef.current = new ChartJS(ctx, {
          type: WordCloudController.id,
          data: chartConfig,
          options: options,
        });
      } catch (error) {
        console.error("Error creating word cloud chart:", error);
      }
    }
  };

  // Effect to handle chart creation/destruction based on data changes
  useEffect(() => {
    if (processedData.labels.length > 0) {
      // Small delay to ensure the canvas is visible
      const timer = setTimeout(() => {
        createOrUpdateChart();
      }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ height: "400px", width: "100%" }}>
      <canvas ref={chartRef} />
    </div>
  );
};

export default WordCloud;
