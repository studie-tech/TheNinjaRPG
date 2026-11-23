"use client";

import {
  Castle,
  ChevronDown,
  Hand,
  type LucideIcon,
  ScrollText,
  Shield,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  SHURIKEN_SIEGE_LOGO_URL,
  TD_DAILY_WAVES,
  TD_STAGE_IMAGE_URLS,
} from "@/drizzle/constants";
import { MiniGameGuestHero } from "@/layout/MiniGameGuestHero";
import {
  TD_BOSS_INTERVAL,
  TD_ERA_INTERVAL,
  TD_SEAL_ARTS,
  TD_SENTRIES,
  TD_STAGES,
  TD_ULTIMATES,
} from "@/libs/towerDefense/content";
import { TD_GAME_NAME, TD_LANDING_FAQ } from "@/libs/towerDefense/landing";

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
    <MiniGameGuestHero
      id="td"
      name={TD_GAME_NAME}
      logo={{ src: SHURIKEN_SIEGE_LOGO_URL, width: 480, height: 200 }}
      background={TD_STAGE_IMAGE_URLS.Dusk}
      title="Hold the line"
      description={`Raiders march on the village and you are its last line. Weave hand seals, raise sentries and unleash ultimate jutsu against endless waves on the road to wave ${TD_STAGES.at(-1)?.wave}.`}
      stats={[
        { value: `${TD_STAGES.at(-1)?.wave}+`, label: "waves" },
        { value: `${TD_SEAL_ARTS.length}`, label: "seal arts" },
        { value: `${TD_ULTIMATES.length}`, label: "ultimates" },
      ]}
      benefit={{
        title: "Daily Guard Hall duty",
        description: `Signed-in defenders earn ryo, prestige and village tokens once a day for clearing ${TD_DAILY_WAVES} waves in one run. A free account also saves your scrolls and Guard Hall upgrades.`,
      }}
      disabled={props.disabled}
      isStarting={props.isStarting}
      onPlay={props.onPlay}
    />

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
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-base [&::-webkit-details-marker]:hidden">
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

const Feature = (props: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="flex gap-3 rounded-lg border bg-card p-3">
    <props.icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
    <div>
      <h3 className="font-semibold text-base">{props.title}</h3>
      <p className="text-muted-foreground text-sm">{props.children}</p>
    </div>
  </div>
);
