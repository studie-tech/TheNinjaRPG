"use client";

import { Play, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { MiniGameDailyDuty } from "@/layout/MiniGameDailyDuty";

/** Introduces a free minigame and explains what playing with an account adds. */
export const MiniGameGuestHero = (props: {
  id: string;
  name: string;
  logo: { src: string; width: number; height: number };
  background: string;
  title: string;
  description: ReactNode;
  stats: readonly { value: string; label: string }[];
  benefit: { title: string; description: ReactNode };
  disabled: boolean;
  isStarting?: boolean;
  playLabel?: string;
  onPlay: () => void;
}) => (
  <div className="@container space-y-4">
    <section
      aria-label={`${props.name}: play for free`}
      className="relative overflow-hidden rounded-xl border border-black/20 bg-black text-white shadow-lg"
    >
      <Image
        src={props.background}
        alt=""
        width={1024}
        height={683}
        priority
        className="absolute inset-0 h-full w-full object-cover opacity-80"
      />
      <span className="absolute inset-0 bg-gradient-to-r from-black/50 to-black/85" />
      <div className="relative space-y-4 p-4 @lg:p-5">
        {/* At 384px of content width, a logo and readable copy fit side by side. */}
        <div className="flex flex-col items-center gap-4 @lg:flex-row">
          <Image
            src={props.logo.src}
            alt={props.name}
            width={props.logo.width}
            height={props.logo.height}
            priority
            className="h-24 w-auto max-w-full shrink-0 object-contain drop-shadow-lg @lg:h-auto @lg:w-[30%]"
          />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-[0.75rem] font-semibold tracking-widest text-amber-300 uppercase">
              Free browser game · No download
            </p>
            <h2 className="text-2xl leading-tight font-bold @lg:text-3xl">
              {props.title}
            </h2>
            <p className="text-base text-white/90">{props.description}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                className="bg-amber-500 text-base font-bold text-black hover:bg-amber-400 pointer-coarse:min-h-[44px]"
                disabled={props.disabled}
                onClick={props.onPlay}
              >
                <Play className="mr-2 h-5 w-5" aria-hidden />
                {props.isStarting
                  ? "Preparing..."
                  : (props.playLabel ?? "Play now, free")}
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/60 bg-black/30 text-base text-white hover:bg-black/50 hover:text-white pointer-coarse:min-h-[44px]"
              >
                <Link href="/signup">
                  <UserPlus className="mr-2 h-5 w-5" aria-hidden />
                  Create free account
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <dl
          className="grid gap-2 text-center"
          style={{
            gridTemplateColumns: `repeat(${props.stats.length}, minmax(0, 1fr))`,
          }}
        >
          {props.stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col-reverse rounded-lg bg-white/10 px-2 py-1.5 backdrop-blur-sm"
            >
              <dt className="text-[0.875rem] text-white/75">{stat.label}</dt>
              <dd className="text-lg font-bold">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
    <MiniGameDailyDuty
      id={`${props.id}-guest-benefit`}
      title={props.benefit.title}
      description={props.benefit.description}
      done={false}
      action={
        <Button
          asChild
          size="sm"
          className="text-[0.875rem] pointer-coarse:min-h-[44px]"
        >
          <Link href="/signup">
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
            Join to earn
          </Link>
        </Button>
      }
    />
  </div>
);
