"use client";

import { Chart as ChartJS } from "chart.js/auto";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import VisitorFiltering, {
  getFilter as getVisitorFilter,
  useFiltering as useVisitorFiltering,
} from "@/layout/VisitorFiltering";
import {
  betaPdf,
  betaPosterior,
  kde,
  mean,
  quantile,
  sampleBeta,
} from "@/libs/statistics";

type VariantAgg = { variant: string; loaded: number; register: number };
type ExperimentAgg = { experiment: string; variants: VariantAgg[] };

// statistical helpers are imported from @/libs/statistics

const inferControlTreatment = (
  variants: VariantAgg[],
): {
  a?: VariantAgg;
  b?: VariantAgg;
  ambiguous: boolean;
} => {
  if (variants.length < 2) return { a: undefined, b: undefined, ambiguous: true };
  const byHeuristic = [...variants].sort((x, y) => {
    const rx = x.variant.toLowerCase();
    const ry = y.variant.toLowerCase();
    const score = (s: string) =>
      (/(^|\b)(control|baseline|original)(\b|$)/i.test(s) ? -10 : 0) +
      (/(^|\b)(treatment|variant\s*b)(\b|$)/i.test(s) ? 10 : 0) +
      (/(^|\b)variant\s*a(\b|$)/i.test(s) ? -5 : 0) +
      (/(^|\b)variant\s*b(\b|$)/i.test(s) ? 5 : 0);
    return score(rx) - score(ry) || rx.localeCompare(ry);
  });
  const aVar = byHeuristic[0];
  const bVar = byHeuristic[1];
  if (!aVar || !bVar) return { a: undefined, b: undefined, ambiguous: true };
  const ambiguous = !/(^|\b)(control|baseline|original|variant\s*a)(\b|$)/i.test(
    aVar.variant,
  );
  return { a: aVar, b: bVar, ambiguous };
};

const DistributionChart: React.FC<{
  title: string;
  labels: number[];
  datasets: {
    label: string;
    data: number[];
    color: string;
    fill?: boolean;
    fillColor?: string;
    borderWidth?: number;
  }[];
  yTitle?: string;
}> = ({ title, labels, datasets, yTitle = "Density" }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [xZoomMin, xZoomMax] = useMemo(() => {
    const threshold = 1;
    const { firstIdx, lastIdx } = labels.reduce(
      (acc, _xVal, i) => {
        const hasHighDensity = datasets.some((ds) => (ds?.data[i] ?? 0) >= threshold);
        if (hasHighDensity) {
          if (acc.firstIdx === -1) acc.firstIdx = i;
          acc.lastIdx = i;
        }
        return acc;
      },
      { firstIdx: -1, lastIdx: -1 },
    );
    const fallbackMin = labels[0] ?? 0;
    const fallbackMax = labels[labels.length - 1] ?? fallbackMin;
    const min = firstIdx === -1 ? fallbackMin : (labels[firstIdx] ?? fallbackMin);
    const max = lastIdx === -1 ? fallbackMax : (labels[lastIdx] ?? fallbackMax);
    return [min, max] as const;
  }, [labels, datasets]);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const chart = new ChartJS(ctx, {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          borderColor: d.color,
          backgroundColor: d.fill ? (d.fillColor ?? d.color) : d.color,
          pointRadius: 0,
          borderWidth: d.borderWidth ?? 2,
          fill: d.fill ? "origin" : false,
          tension: 0.2,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: title },
            min: xZoomMin,
            max: xZoomMax,
          },
          y: { type: "linear", title: { display: true, text: yTitle } },
        },
        plugins: { legend: { display: true } },
      },
    });
    return () => chart.destroy();
  }, [labels, datasets, title, yTitle, xZoomMax]);
  return (
    <div className="w-full" style={{ height: 260 }}>
      <canvas ref={ref} />
    </div>
  );
};

const ExperimentRow: React.FC<{ exp: ExperimentAgg }> = ({ exp }) => {
  const { a, b, ambiguous } = useMemo(
    () => inferControlTreatment(exp.variants),
    [exp.variants],
  );

  const haveTwo = !!a && !!b;
  const aV: VariantAgg = a ?? {
    variant: exp.variants[0]?.variant ?? "Variant A",
    loaded: 0,
    register: 0,
  };
  const bV: VariantAgg = b ?? {
    variant: exp.variants[1]?.variant ?? "Variant B",
    loaded: 0,
    register: 0,
  };

  const aPost = betaPosterior(aV.register, Math.max(1, aV.loaded));
  const bPost = betaPosterior(bV.register, Math.max(1, bV.loaded));
  const aMean = aPost.mean;
  const bMean = bPost.mean;

  // Monte Carlo posterior sampling
  const SAMPLES = 8000;
  const aSamples = useMemo(
    () => Array.from({ length: SAMPLES }, () => sampleBeta(aPost.a, aPost.b)),
    [aPost.a, aPost.b],
  );
  const bSamples = useMemo(
    () => Array.from({ length: SAMPLES }, () => sampleBeta(bPost.a, bPost.b)),
    [bPost.a, bPost.b],
  );

  const pBgtA = useMemo(() => {
    let count = 0;
    for (let i = 0; i < SAMPLES; i++)
      if ((bSamples[i] ?? 0) > (aSamples[i] ?? 0)) count++;
    return count / SAMPLES;
  }, [aSamples, bSamples]);

  const impSamples = useMemo(
    () => aSamples.map((x, i) => (bSamples[i] ?? 0) - x),
    [aSamples, bSamples],
  );

  const aCI = useMemo(
    () => [quantile(aSamples, 0.025), quantile(aSamples, 0.975)] as [number, number],
    [aSamples],
  );
  const bCI = useMemo(
    () => [quantile(bSamples, 0.025), quantile(bSamples, 0.975)] as [number, number],
    [bSamples],
  );

  const relLiftMean = useMemo(() => {
    const arr = new Array<number>(SAMPLES);
    for (let i = 0; i < SAMPLES; i++)
      arr[i] =
        ((bSamples[i] ?? 0) - (aSamples[i] ?? 0)) / Math.max(1e-9, aSamples[i] ?? 0);
    return mean(arr);
  }, [aSamples, bSamples]);

  // Beta PDFs over [0,1]
  const x = useMemo(() => Array.from({ length: 200 }, (_, i) => i / 199), []);
  const aPdf = useMemo(
    () =>
      x.map((xi) =>
        betaPdf(Math.min(1 - 1e-9, Math.max(1e-9, xi)), aPost.a ?? 1, aPost.b ?? 1),
      ),
    [x, aPost.a, aPost.b],
  );
  const bPdf = useMemo(
    () =>
      x.map((xi) =>
        betaPdf(Math.min(1 - 1e-9, Math.max(1e-9, xi)), bPost.a ?? 1, bPost.b ?? 1),
      ),
    [x, bPost.a, bPost.b],
  );

  // Improvement KDE on a smart grid based on quantiles
  const impGrid = useMemo(() => {
    const lo = Math.max(-1, quantile(impSamples, 0.01));
    const hi = Math.min(1, quantile(impSamples, 0.99));
    const a = Number.isFinite(lo) ? lo : -0.5;
    const bnd = Number.isFinite(hi) ? hi : 0.5;
    return Array.from({ length: 200 }, (_, i) => a + (i / 199) * (bnd - a));
  }, [impSamples]);

  const impPdf = useMemo(() => kde(impSamples, impGrid), [impSamples, impGrid]);
  const posPdf = useMemo(
    () => impGrid.map((xi, i) => (xi >= 0 ? (impPdf[i] ?? 0) : 0)),
    [impGrid, impPdf],
  );
  const negPdf = useMemo(
    () => impGrid.map((xi, i) => (xi < 0 ? (impPdf[i] ?? 0) : 0)),
    [impGrid, impPdf],
  );

  // Observed rates
  const aObserved = aV.loaded > 0 ? aV.register / aV.loaded : 0;
  const bObserved = bV.loaded > 0 ? bV.register / bV.loaded : 0;

  // Guardrails & notices
  const MIN_CONVERSIONS = 100;
  const MIN_EXPOSURES = 500;
  const totalLoaded = aV.loaded + bV.loaded;
  const trafficShareA = totalLoaded > 0 ? aV.loaded / totalLoaded : 0.5;
  const unbalancedTraffic = trafficShareA < 0.4 || trafficShareA > 0.6;
  const insufficientConversions =
    aV.register < MIN_CONVERSIONS || bV.register < MIN_CONVERSIONS;
  const insufficientExposures = aV.loaded < MIN_EXPOSURES || bV.loaded < MIN_EXPOSURES;
  const hasWarnings =
    unbalancedTraffic || insufficientConversions || insufficientExposures;

  const moreThanTwo = exp.variants.length > 2;

  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-2">
      {!haveTwo && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-900 text-xs md:col-span-2">
          Need at least two variants to compare. Showing placeholders.
        </div>
      )}
      {moreThanTwo && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-blue-900 text-xs md:col-span-2">
          More than two variants detected. Showing a pairwise comparison. Consider
          running pairwise comparisons across all variants for full insight.
        </div>
      )}
      {ambiguous && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs md:col-span-2">
          Control/Treatment naming is ambiguous; ordering may be arbitrary.
        </div>
      )}
      {hasWarnings && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-900 md:col-span-2">
          Preliminary results — recommended guardrails not met:
          <ul className="list-disc pl-5">
            {insufficientConversions && (
              <li>
                Low conversions (min {MIN_CONVERSIONS} each). A: {aV.register}, B:{" "}
                {bV.register}.
              </li>
            )}
            {insufficientExposures && (
              <li>
                Low sample size (min {MIN_EXPOSURES} each). A: {aV.loaded}, B:{" "}
                {bV.loaded}.
              </li>
            )}
            {unbalancedTraffic && (
              <li>
                Unbalanced traffic split (A share = {(trafficShareA * 100).toFixed(1)}
                %).
              </li>
            )}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="font-semibold text-sm">
          Conversion Rate Distributions (Beta posterior)
        </div>
        <DistributionChart
          title="Conversion rate"
          labels={x}
          datasets={[
            {
              label: `${aV.variant} (n=${aV.loaded}, conv=${aV.register})`,
              data: aPdf,
              color: "hsl(42 90% 45%)",
            },
            {
              label: `${bV.variant} (n=${bV.loaded}, conv=${bV.register})`,
              data: bPdf,
              color: "hsl(210 70% 45%)",
            },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-semibold text-sm">
          Improvement Distribution (Treatment − Control)
        </div>
        <DistributionChart
          title={`Improvement (${bV.variant} - ${aV.variant})`}
          labels={impGrid}
          datasets={[
            {
              label: `${bV.variant} better`,
              data: posPdf,
              color: "hsl(210 70% 45%)",
              fill: true,
              fillColor: "hsl(210 70% 45% / 0.35)",
              borderWidth: 1,
            },
            {
              label: `${aV.variant} better`,
              data: negPdf,
              color: "hsl(42 90% 45%)",
              fill: true,
              fillColor: "hsl(42 90% 45% / 0.35)",
              borderWidth: 1,
            },
            {
              label: "density",
              data: impPdf,
              color: "hsl(210 10% 20%)",
              fill: false,
              borderWidth: 2,
            },
          ]}
        />
      </div>
      <div className="text-sm md:col-span-2">
        <div className="font-semibold">Executive Summary</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div>
              What happened so far (raw data): out of every 100 visitors — {aV.variant}
              {": "}
              {(aObserved * 100).toFixed(1)}% convert, {bV.variant}
              {": "}
              {(bObserved * 100).toFixed(1)}% convert.
            </div>
            <div>
              Best estimate with 95% range (accounts for noise): {aV.variant}{" "}
              {(aMean * 100).toFixed(1)}% [{(aCI[0] * 100).toFixed(1)}%,{" "}
              {(aCI[1] * 100).toFixed(1)}%] and {bV.variant} {(bMean * 100).toFixed(1)}%
              [{(bCI[0] * 100).toFixed(1)}%, {(bCI[1] * 100).toFixed(1)}%]. This is the
              range we expect the true conversion rates to fall within.
            </div>
          </div>
          <div>
            <div>
              How likely {bV.variant} is better than {aV.variant}:{" "}
              {(pBgtA * 100).toFixed(1)}%. This is the chance that {bV.variant} truly
              converts better, given the data we have.
            </div>
            <div>
              Typical difference if you chose {bV.variant}:{" "}
              {(relLiftMean * 100).toFixed(1)}% vs {aV.variant} (positive means better).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AbTestResults: React.FC = () => {
  const visitorFilterState = useVisitorFiltering();

  const { data, isFetching } = api.data.getAbTests.useQuery(
    { ...getVisitorFilter(visitorFilterState) },
    { staleTime: 60_000 },
  );

  return (
    <ContentBox
      title="A/B Tests"
      subtitle="Live results from experiments"
      initialBreak
      topRightContent={<VisitorFiltering state={visitorFilterState} />}
    >
      {isFetching && <Loader explanation="Loading A/B test results" />}
      {!isFetching && (!data || data.length === 0) && <p>No experiments found.</p>}
      {!isFetching && data && data.length > 0 && (
        <div className="flex flex-col gap-4">
          {data.map((exp) => (
            <div key={exp.experiment} className="flex flex-col gap-2">
              <div className="font-bold text-lg">{exp.experiment}</div>
              <ExperimentRow exp={exp} />
            </div>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

export default AbTestResults;
