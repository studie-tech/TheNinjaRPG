import { CheckCircle2, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/libs/shadui";

/** A daily minigame objective with its completion state and village rewards. */
export const MiniGameDailyDuty = (props: {
  id: string;
  title: string;
  description: ReactNode;
  done: boolean;
  reward?: { ryo: number; prestige: number; villageTokens: number };
  hasVillage?: boolean;
  action?: ReactNode;
}) => (
  <section
    aria-labelledby={props.id}
    className={cn(
      "flex flex-wrap items-center gap-3 rounded-xl border-2 p-3",
      props.done
        ? "border-emerald-500/60 bg-emerald-500/10"
        : "border-amber-500/70 bg-amber-500/10",
    )}
  >
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
        props.done
          ? "bg-emerald-500/20 text-emerald-600"
          : "bg-amber-500/20 text-amber-600",
      )}
      aria-hidden
    >
      {props.done ? (
        <CheckCircle2 className="h-6 w-6" />
      ) : (
        <ScrollText className="h-6 w-6" />
      )}
    </span>
    <div className="min-w-[min(100%,16rem)] flex-1">
      <h2 id={props.id} className="text-base leading-tight font-bold">
        {props.title}
      </h2>
      <p className="text-muted-foreground text-[0.875rem]">{props.description}</p>
    </div>
    {!props.done && props.reward && (
      <span className="flex flex-wrap gap-1.5 text-[0.875rem] font-bold">
        <RewardChip>{props.reward.ryo.toLocaleString()} ryo</RewardChip>
        <RewardChip>{props.reward.prestige} prestige</RewardChip>
        {props.hasVillage && (
          <RewardChip>{props.reward.villageTokens} village tokens</RewardChip>
        )}
      </span>
    )}
    {props.action}
  </section>
);

const RewardChip = (props: { children: ReactNode }) => (
  <span className="rounded-md bg-amber-500/20 px-2 py-0.5 whitespace-nowrap">
    {props.children}
  </span>
);
