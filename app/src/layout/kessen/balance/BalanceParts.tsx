"use client";

import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react";
import type { KessenBalanceFlag } from "@/libs/kessen/balance";
import { cn } from "@/libs/shadui";
import { clamp } from "@/utils/math";

/** The worst severity among the flags, or "ok". */
export type KessenBalanceStatus = "ok" | "warn" | "break";

export const statusOf = (flags: readonly KessenBalanceFlag[]): KessenBalanceStatus =>
  flags.some((flag) => flag.severity === "break")
    ? "break"
    : flags.length > 0
      ? "warn"
      : "ok";

const STATUS_TEXT: Record<KessenBalanceStatus, string> = {
  ok: "text-green-700 dark:text-green-500",
  warn: "text-amber-600 dark:text-amber-400",
  break: "text-red-600 dark:text-red-500",
};

const STATUS_MARK: Record<KessenBalanceStatus, string> = {
  ok: "bg-foreground",
  warn: "bg-amber-500",
  break: "bg-red-600",
};

const STATUS_LABEL: Record<KessenBalanceStatus, string> = {
  ok: "In guidelines",
  warn: "Warning",
  break: "Breaks a guideline",
};

/** Icon and short label of a status. */
export const StatusMark = ({
  status,
  label,
  className,
}: {
  status: KessenBalanceStatus;
  /** Visible text; the icon alone (with an accessible name) when omitted. */
  label?: string;
  className?: string;
}) => {
  const Icon =
    status === "break"
      ? OctagonAlert
      : status === "warn"
        ? AlertTriangle
        : CheckCircle2;
  return (
    <span
      className={cn("inline-flex items-center gap-1", STATUS_TEXT[status], className)}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden={label !== undefined} />
      {label === undefined ? (
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      ) : (
        <span>{label}</span>
      )}
    </span>
  );
};

/** The flags of one subject, breaks first. */
export const FlagList = ({
  flags,
  className,
}: {
  flags: readonly KessenBalanceFlag[];
  className?: string;
}) => {
  if (flags.length === 0) return null;
  const sorted = [...flags].sort(
    (a, b) => (a.severity === "break" ? 0 : 1) - (b.severity === "break" ? 0 : 1),
  );
  return (
    <ul className={cn("grid gap-0.5", className)}>
      {sorted.map((flag) => (
        <li
          key={`${flag.rule}:${flag.message}`}
          className={cn("flex items-start gap-1", STATUS_TEXT[flag.severity])}
        >
          <StatusMark status={flag.severity} className="mt-px" />
          <span>{flag.message}</span>
        </li>
      ))}
    </ul>
  );
};

/** A shaded range on a meter's scale. */
interface MeterBand {
  from: number;
  to: number;
  className: string;
}

/**
 * A value on a scale with its guideline ranges shaded and, optionally, its uncertainty
 * as a whisker. Values off the scale pin to its ends.
 */
export const BandMeter = ({
  value,
  whisker = 0,
  domain,
  bands,
  status,
  label,
  className,
}: {
  value: number;
  whisker?: number;
  domain: readonly [number, number];
  bands: readonly MeterBand[];
  status: KessenBalanceStatus;
  /** Accessible description of the value and its range. */
  label: string;
  className?: string;
}) => {
  const [min, max] = domain;
  const at = (x: number) => `${(100 * (clamp(x, min, max) - min)) / (max - min)}%`;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("bg-muted relative h-2.5 w-full rounded-full", className)}
    >
      {bands.map((band) => (
        <span
          key={`${band.from}:${band.to}`}
          className={cn("absolute inset-y-0", band.className)}
          style={{
            left: at(band.from),
            width: `calc(${at(band.to)} - ${at(band.from)})`,
          }}
        />
      ))}
      {whisker > 0 ? (
        <span
          className={cn("absolute top-1/2 h-0.5 -translate-y-1/2", STATUS_MARK[status])}
          style={{
            left: at(value - whisker),
            width: `calc(${at(value + whisker)} - ${at(value - whisker)})`,
          }}
        />
      ) : null}
      <span
        className={cn(
          "ring-background absolute -top-0.5 h-3.5 w-1 -translate-x-1/2 rounded-full ring-1",
          STATUS_MARK[status],
        )}
        style={{ left: at(value) }}
      />
    </div>
  );
};

/** Shading of a guideline's limit and, inside it, its target. */
export const LIMIT_BAND = "bg-green-600/20";
export const TARGET_BAND = "bg-green-600/35";

/** A signed number with one decimal: "+1.5", "−0.5", "0.0". */
export const signed = (value: number, digits = 1) => {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${fixed}`;
};
