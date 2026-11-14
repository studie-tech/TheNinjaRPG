"use client";

import { Chart as ChartJS } from "chart.js/auto";
import type React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import VisitorFiltering, {
  getFilter as getVisitorFilter,
  useFiltering as useVisitorFiltering,
} from "@/layout/VisitorFiltering";
import { LEMU_EXPERIMENT, lemuLabel } from "@/libs/lemuExperiment";
import {
  betaCurve,
  betaPosterior,
  kde,
  mean,
  quantile,
  sampleBeta,
} from "@/libs/statistics";
import {
  WALLPAPER_EXPERIMENT,
  WALLPAPER_VARIANTS,
  wallpaperLabel,
} from "@/libs/wallpaperExperiment";
import { humanizeIdentifier } from "@/utils/string";

/** Show full-history results for recently active tests, with source/device filters. */
export const AbTestResults: React.FC = () => {
  const visitorFilterState = useVisitorFiltering();

  const { data, isFetching, isError, refetch } = api.data.getAbTests.useQuery(
    { ...getVisitorFilter(visitorFilterState, false) },
    { staleTime: 60_000 },
  );

  return (
    <ContentBox
      title="A/B/C Tests"
      subtitle="All-time unique visits and tutorial completions for tests active in the last 7 days"
      initialBreak
      topRightContent={
        <VisitorFiltering state={visitorFilterState} includeDates={false} />
      }
    >
      {isFetching && <Loader explanation="Loading A/B test results" />}
      {isError && (
        <p role="alert">
          Could not load experiment results.{" "}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </p>
      )}
      {!isFetching && !isError && (!data || data.length === 0) && (
        <p>No experiments with activity in the last 7 days match these filters.</p>
      )}
      {!isFetching && data && data.length > 0 && (
        <div className="flex flex-col gap-4">
          {data.map((exp) => (
            <ExperimentResults key={exp.experiment} exp={exp} />
          ))}
        </div>
      )}
    </ContentBox>
  );
};

export default AbTestResults;

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
  }, [labels, datasets, title, yTitle, xZoomMin, xZoomMax]);
  return (
    <div className="w-full" style={{ height: 260 }}>
      <canvas ref={ref} />
    </div>
  );
};

const ExperimentRow: React.FC<{
  experiment: string;
  control: VariantAgg;
  treatment: VariantAgg;
  ambiguous: boolean;
}> = ({ experiment, control: aV, treatment: bV, ambiguous }) => {
  const aPost = betaPosterior(aV.register, aV.loaded);
  const bPost = betaPosterior(bV.register, bV.loaded);
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
  const { x, pdf: aPdf } = useMemo(
    () => betaCurve(aPost.a, aPost.b),
    [aPost.a, aPost.b],
  );
  const { pdf: bPdf } = useMemo(() => betaCurve(bPost.a, bPost.b), [bPost.a, bPost.b]);

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

  const aLabel = variantLabel(experiment, aV.variant);
  const bLabel = variantLabel(experiment, bV.variant);

  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-2">
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
              label: `${aLabel} (n=${aV.loaded}, conv=${aV.register})`,
              data: aPdf,
              color: "hsl(42 90% 45%)",
            },
            {
              label: `${bLabel} (n=${bV.loaded}, conv=${bV.register})`,
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
          title={`Improvement (${bLabel} - ${aLabel})`}
          labels={impGrid}
          datasets={[
            {
              label: `${bLabel} better`,
              data: posPdf,
              color: "hsl(210 70% 45%)",
              fill: true,
              fillColor: "hsl(210 70% 45% / 0.35)",
              borderWidth: 1,
            },
            {
              label: `${aLabel} better`,
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
              What happened so far (raw data): out of every 100 visitors — {aLabel}
              {": "}
              {(aObserved * 100).toFixed(1)}% convert, {bLabel}
              {": "}
              {(bObserved * 100).toFixed(1)}% convert.
            </div>
            <div>
              Best estimate with 95% range (accounts for noise): {aLabel}{" "}
              {(aMean * 100).toFixed(1)}% [{(aCI[0] * 100).toFixed(1)}%,{" "}
              {(aCI[1] * 100).toFixed(1)}%] and {bLabel} {(bMean * 100).toFixed(1)}% [
              {(bCI[0] * 100).toFixed(1)}%, {(bCI[1] * 100).toFixed(1)}%]. This is the
              range we expect the true conversion rates to fall within.
            </div>
          </div>
          <div>
            <div>
              How likely {bLabel} is better than {aLabel}: {(pBgtA * 100).toFixed(1)}%.
              This is the chance that {bLabel} truly converts better, given the data we
              have.
            </div>
            <div>
              Typical difference if you chose {bLabel}: {(relLiftMean * 100).toFixed(1)}
              % vs {aLabel} (positive means better).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ExperimentResults = ({ exp }: { exp: ExperimentAgg }) => {
  const panelId = useId();
  const inferred = inferControlTreatment(exp.variants);
  const baseline = inferred.a ?? exp.variants[0];
  const defaultVariant =
    exp.variants.find((arm) => arm.variant !== baseline?.variant) ?? baseline;
  const [selectedVariant, setSelectedVariant] = useState(defaultVariant?.variant);
  const selected =
    exp.variants.find((arm) => arm.variant === selectedVariant) ?? defaultVariant;
  const label = (variant: string) => variantLabel(exp.experiment, variant);
  const totalLoaded = exp.variants.reduce((total, arm) => total + arm.loaded, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold text-lg">{exp.experiment}</div>
      <p className="text-sm">
        {exp.experiment === WALLPAPER_EXPERIMENT
          ? `Wallpaper experiment · control is the fall wallpaper · equal allocation across ${WALLPAPER_VARIANTS.length} village and seasonal candidates.`
          : exp.experiment === LEMU_EXPERIMENT
            ? "Lemu experiment · current Lemu baseline and six alternatives · equal allocation across seven arms."
            : "Tutorial experiment"}
      </p>
      <p className="text-sm">
        Select a variant to view its graph and comparison with the baseline.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Variant</th>
              <th>Visits</th>
              <th>Tutorial completions</th>
              <th>Conversion</th>
              <th>Traffic share</th>
            </tr>
          </thead>
          <tbody>
            {exp.variants.map((variant) => (
              <tr
                key={variant.variant}
                className={
                  selected?.variant === variant.variant ? "bg-accent" : undefined
                }
              >
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    aria-pressed={selected?.variant === variant.variant}
                    aria-controls={panelId}
                    onClick={() => setSelectedVariant(variant.variant)}
                  >
                    {label(variant.variant)}
                  </Button>
                </td>
                <td>{variant.loaded}</td>
                <td>{variant.register}</td>
                <td>
                  {variant.loaded
                    ? `${((100 * variant.register) / variant.loaded).toFixed(1)}%`
                    : "—"}
                </td>
                <td>
                  {((100 * variant.loaded) / Math.max(1, totalLoaded)).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs">
        Counts deduplicate by IP. Comparisons are exploratory; comparing several
        candidates increases the chance of a false winner. Wait for sufficient traffic
        and tutorial completions in every arm.
      </p>
      {baseline && selected && (
        <section id={panelId} aria-label={`${label(selected.variant)} results`}>
          <h3 className="font-semibold">
            {label(selected.variant)}
            {selected.variant !== baseline.variant &&
              ` versus ${label(baseline.variant)}`}
          </h3>
          {selected.variant === baseline.variant ? (
            <VariantDistribution
              key={selected.variant}
              variant={selected}
              label={label(selected.variant)}
            />
          ) : (
            <ExperimentRow
              key={selected.variant}
              experiment={exp.experiment}
              control={baseline}
              treatment={selected}
              ambiguous={inferred.ambiguous}
            />
          )}
        </section>
      )}
    </div>
  );
};

const VariantDistribution = ({
  variant,
  label,
}: {
  variant: VariantAgg;
  label: string;
}) => {
  const posterior = betaPosterior(variant.register, variant.loaded);
  const { x, pdf } = useMemo(
    () => betaCurve(posterior.a, posterior.b),
    [posterior.a, posterior.b],
  );
  return (
    <div className="rounded-md border p-3">
      <p className="text-sm">
        Baseline conversion rate distribution (Beta posterior). Select another variant
        to compare it with this baseline.
      </p>
      <DistributionChart
        title="Conversion rate"
        labels={x}
        datasets={[
          {
            label: `${label} (n=${variant.loaded}, conv=${variant.register})`,
            data: pdf,
            color: "hsl(42 90% 45%)",
          },
        ]}
      />
    </div>
  );
};

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

/** Readable name of a variant in the experiments that define one. */
const variantLabel = (experiment: string, variant: string) => {
  if (experiment === WALLPAPER_EXPERIMENT) return wallpaperLabel(variant);
  if (experiment === LEMU_EXPERIMENT) return lemuLabel(variant);
  return humanizeIdentifier(variant);
};

type VariantAgg = { variant: string; loaded: number; register: number };

type ExperimentAgg = { experiment: string; variants: VariantAgg[] };
