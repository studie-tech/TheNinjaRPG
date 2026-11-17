"use client";

import {
  Castle,
  ChevronDown,
  Hand,
  type LucideIcon,
  Play,
  ScrollText,
  Shield,
  Sparkles,
  Trophy,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TD_STAGE_IMAGE_URLS } from "@/drizzle/constants";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import {
  TD_BOSS_INTERVAL,
  TD_ERA_INTERVAL,
  TD_SEAL_ARTS,
  TD_SENTRIES,
  TD_STAGES,
  TD_ULTIMATES,
} from "@/libs/towerDefense/content";
import { TD_LANDING_FAQ } from "@/libs/towerDefense/landing";

/**
 * The public face of tower defense for visitors without an account: what the game is,
 * one button into a free run and a reason to sign up. It renders in the prerendered page,
 * so search engines read the same text players do.
 */
export const TowerDefenseLanding = (props: {
  isStarting: boolean;
  disabled: boolean;
  onPlay: () => void;
}) => (
  <div className="@container space-y-4">
    <section className="relative overflow-hidden rounded-xl border border-black/20 bg-black text-white shadow-lg">
      <Image
        src={TD_STAGE_IMAGE_URLS.Dusk}
        alt=""
        width={960}
        height={640}
        priority
        className="absolute inset-0 h-full w-full object-cover opacity-80"
      />
      <span className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/10" />
      <div className="relative max-w-xl space-y-3 p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">
          Free browser game · No download
        </p>
        <h2 className="font-bold text-3xl leading-tight sm:text-4xl">
          Hold the line against endless raiders
        </h2>
        <p className="text-sm text-white/90 sm:text-base">
          Raiders march on the village and you are its last line. Weave hand seals,
          raise sentries and unleash ultimate jutsu against endless waves on the road to
          wave {TD_STAGES.at(-1)?.wave}.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="lg"
            className="bg-amber-500 text-black hover:bg-amber-400"
            disabled={props.disabled}
            onClick={props.onPlay}
          >
            <Play className="mr-2 h-5 w-5" />
            {props.isStarting ? "Preparing..." : "Play now, free"}
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-white/60 bg-black/30 text-white hover:bg-black/50 hover:text-white"
          >
            <Link href="/signup">
              <UserPlus className="mr-2 h-5 w-5" />
              Create free account
            </Link>
          </Button>
        </div>
        <dl className="grid grid-cols-3 gap-2 pt-2 text-center">
          <HeroStat value={`${TD_STAGES.at(-1)?.wave}+`} label="waves" />
          <HeroStat value={`${TD_SEAL_ARTS.length}`} label="seal arts" />
          <HeroStat value={`${TD_ULTIMATES.length}`} label="ultimates" />
        </dl>
      </div>
    </section>

    <section aria-labelledby="td-features" className="space-y-2">
      <h2 id="td-features" className="font-bold text-xl">
        Why players keep coming back
      </h2>
      <div className="grid gap-2 @[520px]:grid-cols-2 @[820px]:grid-cols-3">
        <Feature icon={Hand} title="Weave hand seals">
          Chain tiger, snake, dog and bird seals into {TD_SEAL_ARTS.length} arts, from
          Dragon Flame to Water Prison.
        </Feature>
        <Feature icon={Castle} title="Raise sentries">
          Place {TD_SENTRIES.length} kinds of sentry, from kunai turrets to frost
          totems, and lay traps where the raiders gather.
        </Feature>
        <Feature icon={Sparkles} title="Unleash ultimates">
          {TD_ULTIMATES.length} ultimate techniques, from a shadow clone army to
          Amaterasu, turn the tide when a wave gets desperate.
        </Feature>
        <Feature icon={Shield} title="Survive changing eras">
          A boss every {TD_BOSS_INTERVAL} waves and a new era every {TD_ERA_INTERVAL}:
          swarms, titans, blood moons and meteor showers change the rules.
        </Feature>
        <Feature icon={ScrollText} title="Grow stronger every run">
          Cleared waves earn scrolls. Spend them in the Guard Hall on permanent
          upgrades, new jutsu and faster game speeds.
        </Feature>
        <Feature icon={Trophy} title="Defend your village">
          Part of TheNinja-RPG: climb the leaderboard and earn a daily reward for you
          and your village.
        </Feature>
      </div>
    </section>

    <section aria-labelledby="td-faq" className="space-y-2">
      <h2 id="td-faq" className="font-bold text-xl">
        Frequently asked questions
      </h2>
      <div className="divide-y rounded-lg border bg-card">
        {TD_LANDING_FAQ.map((entry) => (
          <details key={entry.question} className="group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold [&::-webkit-details-marker]:hidden">
              {entry.question}
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-2 text-muted-foreground text-sm">{entry.answer}</p>
          </details>
        ))}
      </div>
    </section>
  </div>
);

const HeroStat = (props: { value: string; label: string }) => (
  <div className="flex flex-col-reverse rounded-lg bg-white/10 px-2 py-1.5 backdrop-blur-sm">
    <dt className="text-[11px] uppercase tracking-wide text-white/75">{props.label}</dt>
    <dd className="font-bold text-lg">{props.value}</dd>
  </div>
);

const Feature = (props: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="flex gap-3 rounded-lg border bg-card p-3">
    <props.icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
    <div>
      <h3 className="font-semibold">{props.title}</h3>
      <p className="text-muted-foreground text-sm">{props.children}</p>
    </div>
  </div>
);
