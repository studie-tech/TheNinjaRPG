"use client";

import { useUser } from "@clerk/nextjs";
import { AlertTriangle, ChevronRight, UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import PixelPublicHeader from "@/components/layout/PixelPublicHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  IMG_FRONTPAGE_SCREENSHOT_COMBAT,
  IMG_FRONTPAGE_SCREENSHOT_GLOBAL,
  IMG_FRONTPAGE_SCREENSHOT_JUTSUS,
  IMG_FRONTPAGE_SCREENSHOT_SECTOR,
  IMG_FRONTPAGE_SCREENSHOT_VILLAGE,
  IMG_LAYOUT_WELCOME_IMG,
  IMG_LOGO_FULL,
  IMG_PIXEL_HERO_POSTER_OPTIMIZED,
  TOTAL_PLAYERS_MILESTONE,
} from "@/drizzle/constants";
import { env } from "@/env/client.mjs";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import { LEGAL_LINKS } from "@/libs/legalLinks";
import { cn } from "@/libs/shadui";
import { useActiveLayout, useIsPixelLanding } from "@/utils/LayoutContext";
import { getFirstOfNextMonth } from "@/utils/time";

const Welcome: React.FC = () => {
  const activeLayout = useActiveLayout();
  const isPixelLanding = useIsPixelLanding();

  // Snap container for full-height sections
  const backgroundClass = cn(
    "flex flex snap-start snap-always flex-col justify-center gap-4",
  );

  // Content wrapper with background styling
  const contentClass = cn(
    "mr-auto ml-auto flex w-[99%] max-w-[768px] flex-col items-center rounded-xl bg-popover/75",
  );

  // Check if game features should be shown (not in MCP mode)
  const isMcpEnabled = env.NEXT_PUBLIC_MCP_ENABLED === "true";
  const showGameFeatures = !isMcpEnabled;

  if (activeLayout === "pixel" && isPixelLanding) {
    return (
      <>
        <PixelWelcome />
        <Suspense>
          <SetReferal />
        </Suspense>
      </>
    );
  }

  // Render
  return (
    <div
      className={cn(
        "flex h-screen snap-y snap-mandatory flex-col gap-4 overflow-y-scroll",
      )}
    >
      <div className={cn(backgroundClass, "justify-start")}>
        <div className={cn(contentClass, "mb-10")}>
          <Image
            className=""
            src={IMG_LAYOUT_WELCOME_IMG}
            alt="TNR Logo"
            width={1000}
            height={181}
            priority
          />

          <div
            className={
              "flex w-full flex-col items-center gap-0 px-4 py-4 text-center text-sm italic sm:text-md sm:text-xl md:text-md lg:text-xl"
            }
          >
            <p>
              More than <b>{TOTAL_PLAYERS_MILESTONE.toLocaleString()}</b> have played
              TheNinja-RPG!
            </p>
            <p>Join the new version and experience our ninja world!</p>
            <Link href="/signup" aria-label="Signup" className="my-3 w-full px-3">
              <Button
                id="signup_btn"
                className="w-full font-bold text-xl"
                size="xl2"
                animation="glow"
              >
                <UserPlus className="mr-2 h-6 w-6" />
                Create an Account
              </Button>
            </Link>
          </div>
          <div className={"flex w-full flex-col items-center justify-center gap-4"}>
            <div className={cn("mb-4 inline items-center gap-2 text-xl")}>
              Already have an account?{" "}
              <Link href="/login" aria-label="Login" className="font-bold underline">
                Log In
              </Link>
            </div>
          </div>
          {/* {isTreatment && (
            <div className=" flex justify-center items-center flex-row">
              <button
                onClick={showPrompt}
                className="w-1/2 cursor-pointer transition-transform hover:scale-105"
                aria-label="Install from Play Store"
              >
                <Image
                  src={IMG_PLAY_STORE_BANNER}
                  width={258}
                  height={100}
                  className="w-full"
                  alt="Screenshot from Play Store"
                />
              </button>
              <button
                onClick={showPrompt}
                className="w-1/2 cursor-pointer transition-transform hover:scale-105"
                aria-label="Install from App Store"
              >
                <Image
                  src={IMG_APP_STORE_BANNER}
                  width={258}
                  height={100}
                  className="w-full"
                  alt="Screenshot from App Store"
                />
              </button>
            </div>
          )} */}
        </div>
      </div>
      {env.NEXT_PUBLIC_MCP_ENABLED === "true" && (
        <>
          <div className={cn(backgroundClass, "justify-start")}>
            <div className={cn(contentClass, "mb-6")}>
              <Alert className="w-full">
                <AlertTriangle className="h-5 w-5" />
                <AlertTitle className="font-bold text-xl">
                  MONTHLY SERVER RESET WARNING
                </AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <p className="text-base">
                    <strong>
                      On this server all user data, villages, clans, and progress will
                      be permanently deleted
                    </strong>{" "}
                    on the 1st of every month at midnight UTC. Time Until Next Reset:
                  </p>
                  <div className="flex flex-col items-center gap-2">
                    <Countdown
                      targetDate={getFirstOfNextMonth()}
                      className="font-bold font-mono text-3xl text-destructive-foreground"
                    />
                  </div>
                </AlertDescription>
              </Alert>
            </div>
          </div>
          <div className="mb-4 flex flex-col gap-4">
            <div
              className={cn(backgroundClass, "pl-3 font-bold text-5xl text-foreground")}
            >
              AI Agent Game
            </div>
            <div className={backgroundClass}>
              <div className={contentClass}>
                <div className="w-full p-3">
                  <div className="flex flex-col gap-4">
                    <h2 className="font-bold text-2xl">Play with AI Assistants</h2>
                    <p>
                      This server for TheNinja-RPG supports the Model Context Protocol
                      (MCP), allowing AI assistants like Claude, ChatGPT, and Cursor to
                      interact with the game on your behalf. Let your AI agent train
                      your ninja, manage your village, engage in combat, and more - all
                      through natural language conversations with your AI assistant.
                    </p>

                    <div className="rounded-lg border border-border bg-muted/50 p-4">
                      <h3 className="mb-2 font-bold text-lg">MCP Server URL</h3>
                      <code className="block rounded bg-background p-3 font-mono text-sm">
                        {env.NEXT_PUBLIC_BASE_URL}/api/mcp
                      </code>
                    </div>

                    <div className="flex flex-col gap-3">
                      <h3 className="font-bold text-xl">Setup Instructions</h3>

                      <McpSetupDetails title="Claude Code (CLI)">
                        <p className="mb-2 text-sm">
                          Add the MCP server using the Claude Code CLI command:
                        </p>
                        <code className="block rounded bg-background p-3 font-mono text-xs">
                          claude mcp add --transport http theninja-rpg{" "}
                          {env.NEXT_PUBLIC_BASE_URL}/api/mcp
                        </code>
                      </McpSetupDetails>

                      <McpSetupDetails title="Claude Desktop">
                        <p className="mb-2 text-sm">
                          Add to your Claude Desktop configuration file
                          (claude_desktop_config.json):
                        </p>
                        <pre className="overflow-x-auto rounded bg-background p-3 font-mono text-xs">
                          {`{
  "mcpServers": {
    "theninja-rpg": {
      "url": "${env.NEXT_PUBLIC_BASE_URL}/api/mcp"
    }
  }
}`}
                        </pre>
                      </McpSetupDetails>

                      <McpSetupDetails title="Cursor / VS Code">
                        <p className="mb-2 text-sm">
                          Add to your MCP settings in the editor&apos;s configuration:
                        </p>
                        <pre className="overflow-x-auto rounded bg-background p-3 font-mono text-xs">
                          {`{
  "mcp": {
    "servers": {
      "theninja-rpg": {
        "url": "${env.NEXT_PUBLIC_BASE_URL}/api/mcp"
      }
    }
  }
}`}
                        </pre>
                      </McpSetupDetails>

                      <McpSetupDetails title="Codex CLI">
                        <p className="mb-2 text-sm">
                          Add the MCP server using the Codex CLI command:
                        </p>
                        <code className="block rounded bg-background p-3 font-mono text-xs">
                          codex mcp add theninja-rpg --url {env.NEXT_PUBLIC_BASE_URL}
                          /api/mcp
                        </code>
                        <p className="mt-2 text-muted-foreground text-xs">
                          Or add to your ~/.codex/config.toml:
                        </p>
                        <pre className="mt-1 overflow-x-auto rounded bg-background p-3 font-mono text-xs">
                          {`[mcp_servers.theninja-rpg]
url = "${env.NEXT_PUBLIC_BASE_URL}/api/mcp"`}
                        </pre>
                      </McpSetupDetails>

                      <McpSetupDetails title="ChatGPT (Codex App)">
                        <p className="mb-2 text-sm">
                          In ChatGPT, workspace admins can add MCP servers via workspace
                          settings. Add the following streamable HTTP server URL:
                        </p>
                        <code className="block rounded bg-background p-3 font-mono text-xs">
                          {env.NEXT_PUBLIC_BASE_URL}/api/mcp
                        </code>
                        <p className="mt-2 text-muted-foreground text-xs">
                          Go to Settings &rarr; Connected Apps &rarr; Add MCP Server,
                          then paste the URL above.
                        </p>
                      </McpSetupDetails>
                    </div>

                    <p className="text-muted-foreground text-sm">
                      When you first connect, you&apos;ll be prompted to authenticate
                      with your TheNinja-RPG account via Clerk OAuth. This allows the AI
                      assistant to perform actions on your behalf securely.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mb-4 flex flex-col gap-4">
            <div
              className={cn(backgroundClass, "pl-3 font-bold text-5xl text-foreground")}
            >
              Human?
            </div>
            <div className={cn(backgroundClass, "justify-start")}>
              <div className={cn(contentClass, "mb-10")}>
                <div className="flex w-full flex-col items-start gap-2 p-3 text-center">
                  <p>
                    If you are looking to play yourself without an AI assistant, please
                    visit
                  </p>
                  <Link
                    href="https://theninja-rpg.com"
                    aria-label="Signup"
                    className="w-full px-3"
                  >
                    <Button
                      id="signup_btn"
                      className="w-full font-bold text-xl"
                      size="xl2"
                      animation="glow"
                    >
                      <UserPlus className="mr-2 h-6 w-6" />
                      www.theninja-rpg.com
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {showGameFeatures && (
        <>
          <div
            className={cn(backgroundClass, "pl-3 font-bold text-5xl text-foreground")}
          >
            Game Features
          </div>

          <div className={backgroundClass}>
            <div className={contentClass}>
              <div className="w-full p-3">
                <div className="flex flex-col gap-2">
                  <h2 className="font-bold text-2xl">Jutsus</h2>
                  <p>
                    Jutsu are the cornerstone of strategic combat, blending skill,
                    creativity, and tactical planning to overcome your opponents.
                    Players can harness the power of chakra to unleash a variety of
                    techniques, including Ninjutsu, Genjutsu, and Taijutsu, each
                    offering unique combat advantages.
                  </p>
                  <p>
                    By mastering intricate hand seals and managing your chakra reserves,
                    you can develop devastating combos, counter enemy moves, and
                    dominate the battlefield. Explore thousands of potential jutsu
                    combinations and refine your strategy to suit your playstyle—whether
                    you prefer brute strength, deception, or finesse.
                  </p>
                  <Image
                    src={IMG_FRONTPAGE_SCREENSHOT_JUTSUS}
                    width={1024}
                    height={716}
                    className="w-full rounded-xl"
                    alt="Screenshot from Jutsus"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className={backgroundClass}>
            <div className={contentClass}>
              <div className="w-full p-3">
                <div className="flex flex-col gap-2">
                  <h2 className="pt-4 font-bold text-2xl">Combat</h2>
                  <p>
                    Experience the thrill of ninja combat in dynamic, round-based 2D
                    strategic battle system. Every encounter is a test of wit and skill,
                    requiring players to carefully plan their moves, manage resources,
                    and outthink their opponents.
                  </p>
                  <p>
                    Choose from a wide arsenal of techniques, including powerful jutsu,
                    precise attacks, and defensive maneuvers, to adapt to any situation.
                    Each round challenges you to anticipate your opponent&apos;s
                    strategy while leveraging your unique abilities and character build.
                    Timing, positioning, and strategy are key as you engage in battles
                    that demand both tactical decision-making and foresight.
                  </p>
                  <Image
                    src={IMG_FRONTPAGE_SCREENSHOT_COMBAT}
                    width={1024}
                    height={702}
                    className="w-full rounded-xl"
                    alt="Screenshot from Combat"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className={backgroundClass}>
            <div className={contentClass}>
              <div className="w-full p-3">
                <div className="flex flex-col gap-2">
                  <h2 className="pt-4 font-bold text-2xl">Village</h2>
                  <p>
                    The ninja village is your home, your sanctuary, and the center of
                    your growth as a shinobi. This bustling hub is where strategy meets
                    daily life, offering countless opportunities to sharpen your skills,
                    manage your resources, and engage with fellow ninjas.
                  </p>
                  <p>
                    From training grounds that push your abilities to the limit, to the
                    ramen shop where you replenish your stamina, every corner of the
                    village plays a vital role in your journey. The village bank ensures
                    your hard-earned wealth is protected, while the item shop equips you
                    with tools and scrolls to gain an edge in combat. In the clan hall,
                    you&apos;ll collaborate with allies to build your reputation and
                    influence, while the town hall connects you to vital missions and
                    village-wide initiatives. Even your home offers a place of rest and
                    recovery, preparing you for the challenges ahead.
                  </p>
                  <Image
                    src={IMG_FRONTPAGE_SCREENSHOT_VILLAGE}
                    width={1024}
                    height={679}
                    className="w-full rounded-xl"
                    alt="Screenshot from Village"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className={backgroundClass}>
            <div className={contentClass}>
              <div className="w-full p-3">
                <div className="flex flex-col gap-2">
                  <h2 className="pt-4 font-bold text-2xl">Sectors</h2>
                  <p>
                    The 2D travel system brings the ninja world to life, allowing you to
                    explore local sectors, navigate terrain, and engage with players and
                    enemies in real-time. Every move you make across the map opens new
                    opportunities for discovery, combat, and strategy.
                  </p>
                  <p>
                    Travel isn&apos;t just about getting from one place to
                    another—it&apos;s a core part of the game&apos;s experience. Whether
                    you&apos;re scouting enemy territories, setting up ambushes, or
                    evading rival ninjas, the 2D system gives you the freedom to plan
                    your movements and adapt on the fly. Players can launch surprise
                    attacks, defend key locations, or simply traverse the map to reach
                    mission objectives and hidden rewards.
                  </p>
                  <Image
                    src={IMG_FRONTPAGE_SCREENSHOT_SECTOR}
                    width={1024}
                    height={732}
                    className="w-full rounded-xl"
                    alt="Screenshot from Sector"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className={backgroundClass}>
            <div className={contentClass}>
              <div className="w-full p-3">
                <div className="flex flex-col gap-2">
                  <h2 className="pt-4 font-bold text-2xl">Travel</h2>
                  <p>
                    The 3D global travel system expands your journey beyond your
                    village, opening the gates to a vast world filled with diverse
                    regions and hidden secrets. Travel between villages, explore distant
                    lands, and immerse yourself in the rich lore of the ninja universe.
                  </p>
                  <p>
                    Global travel isn&apos;t just about exploration—it&apos;s an
                    opportunity to engage with new challenges and alliances. Visit other
                    villages to trade, forge alliances, or test your strength against
                    foreign rivals. Each region offers unique environments, from dense
                    forests and sprawling deserts to snow-capped mountains, each
                    presenting its own set of opportunities and dangers.
                  </p>
                  <Image
                    src={IMG_FRONTPAGE_SCREENSHOT_GLOBAL}
                    width={1024}
                    height={743}
                    className="w-full rounded-xl"
                    alt="Screenshot from Jutsus"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className={backgroundClass}>
            <div className={cn(contentClass, "p-3")}>{textSEO}</div>
          </div>
        </>
      )}

      <Suspense>
        <SetReferal />
      </Suspense>
    </div>
  );
};

export default Welcome;

const PixelWelcome: React.FC = () => {
  const scrollContainerRef = useRef<HTMLElement>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const heroLogoRef = useRef<HTMLDivElement>(null);
  const showHeaderLogo = usePixelHeaderLogoVisibility(heroLogoRef, scrollContainerRef);
  usePixelHeroVideoPlayback(heroVideoRef, scrollContainerRef);

  const pixelClip = "tnr-pixel-clip";
  const inkPrimaryButton = "tnr-ink-btn tnr-ink-btn-primary tnr-ink-register";
  const inkSecondaryButton = "tnr-ink-btn tnr-ink-btn-secondary";
  const panelClass = cn(
    pixelClip,
    "border border-sky-200/20 bg-slate-950/72 shadow-2xl shadow-black/30 backdrop-blur-md",
  );
  const eyebrowClass = "font-black text-amber-200 text-xs tracking-[0.2em]";
  const sectionClass = "bg-[#09111d] py-16 sm:py-20";
  const alternateSectionClass = "bg-[#0d1a2b] py-16 sm:py-20";
  const containerClass = "mx-auto w-[min(100%_-_32px,1180px)]";
  const screenshotClass = cn(
    pixelClip,
    "w-full border border-sky-200/20 object-cover shadow-2xl shadow-black/35",
  );
  const publicNavLinks = [
    { href: "#world", name: "World" },
    { href: "#features", name: "Features" },
    { href: "#gameplay", name: "Gameplay" },
    { href: "#community", name: "Community" },
  ];

  return (
    <main
      ref={scrollContainerRef}
      className="tnr-pixel-scroll-container h-[100svh] overflow-y-auto overflow-x-hidden bg-[#09111d] text-slate-50"
    >
      <PixelPublicHeader showLogo={showHeaderLogo} navLinks={publicNavLinks} />

      <section
        className="relative grid min-h-[100svh] place-items-center overflow-hidden px-4 pt-28 pb-20"
        data-pixel-snap="hero"
      >
        <video
          ref={heroVideoRef}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          poster={IMG_PIXEL_HERO_POSTER_OPTIMIZED}
          src="/layouts/pixel/tnr-hero.mp4"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,8,14,.68),rgba(8,13,22,.35)_35%,rgba(7,10,18,.9)),radial-gradient(ellipse_at_center,transparent_0_35%,rgba(4,7,13,.72)_85%)]" />
        <div className="relative z-10 flex w-[min(100%,820px)] flex-col items-center text-center">
          <div ref={heroLogoRef}>
            <Image
              src={IMG_LOGO_FULL}
              width={384}
              height={138}
              alt="The Ninja RPG"
              priority
              className="h-auto w-[min(72vw,360px)] drop-shadow-2xl"
            />
          </div>
          <p className="mt-2 font-black text-amber-200 text-xs tracking-[0.2em]">
            A Living Shinobi Realm
          </p>
          <h1 className="mt-4 max-w-[15ch] font-black font-serif text-4xl leading-[1.02] tracking-normal sm:text-5xl md:text-6xl">
            Enter a world shaped by rivalry, growth, and legend
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-100 sm:text-xl">
            In The Ninja RPG, every step draws you deeper into a living anime-inspired
            world of villages, jutsus, conflict, progression, and discovery.
          </p>
          <div className="mt-6 grid w-full max-w-3xl gap-2 text-slate-100 text-sm sm:grid-cols-3">
            {[
              "Free anime ninja MMORPG",
              "Train jutsu, stats, and bloodlines",
              "PvP, villages, missions, and clans",
            ].map((text) => (
              <div
                key={text}
                className="whitespace-nowrap border border-sky-200/20 bg-slate-950/45 px-3 py-2 font-semibold"
              >
                {text}
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className={cn(inkPrimaryButton, "tnr-ink-cta")}>
                <UserPlus className="mr-2 h-5 w-5" />
                Register
              </Button>
            </Link>
            <Link href="/login">
              <Button
                variant="outline"
                size="lg"
                className={cn(inkSecondaryButton, "tnr-ink-cta")}
              >
                Log In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section id="world" className={alternateSectionClass} data-pixel-snap="section">
        <div
          className={cn(
            containerClass,
            "grid gap-8 md:grid-cols-[0.9fr_1.1fr] md:items-center",
          )}
        >
          <div>
            <p className={eyebrowClass}>Intro Artwork</p>
            <h2 className="mt-3 font-black font-serif text-4xl md:text-6xl">
              A Living Shinobi Realm
            </h2>
            <p className="mt-4 text-2xl text-slate-100">
              Enter a world shaped by rivalry, growth, and legend
            </p>
            <p className="mt-5 max-w-xl text-slate-300">
              In The Ninja RPG, every step draws you deeper into a living anime-inspired
              world of villages, jutsus, conflict, progression, and discovery.
            </p>
          </div>
          <div
            className={cn(panelClass, "tnr-pixel-parallax p-3")}
            data-pixel-parallax="0.08"
          >
            <Image
              src="/screenshots/global.webp"
              width={512}
              height={372}
              alt="Intro artwork"
              className={screenshotClass}
            />
          </div>
        </div>
      </section>

      <section
        id="features"
        className={alternateSectionClass}
        data-pixel-snap="section"
      >
        <div
          className={cn(
            containerClass,
            "grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-center",
          )}
        >
          <div
            className={cn(
              panelClass,
              "tnr-pixel-parallax order-last p-3 md:order-none",
            )}
            data-pixel-parallax="0.06"
          >
            <Image
              src="/screenshots/village.webp"
              width={512}
              height={340}
              alt="Village Artwork"
              className={screenshotClass}
            />
          </div>
          <div>
            <p className={eyebrowClass}>Village Artwork</p>
            <p className="mt-3 font-black text-amber-100 text-sm tracking-[0.18em]">
              Village Allegiance
            </p>
            <h2 className="mt-3 font-black font-serif text-4xl md:text-6xl">
              Villages with identity and purpose
            </h2>
            <p className="mt-5 text-slate-300">
              Align yourself with a village, build your reputation, and become part of a
              larger story shaped by loyalty, conflict, and ambition.
            </p>
          </div>
        </div>
      </section>

      <section className={sectionClass} data-pixel-snap="section">
        <div
          className={cn(
            containerClass,
            "grid gap-8 md:grid-cols-[0.9fr_1.1fr] md:items-center",
          )}
        >
          <div>
            <p className={eyebrowClass}>Combat Mastery</p>
            <h2 className="mt-3 font-black font-serif text-4xl md:text-6xl">
              Combat driven by growth and mastery
            </h2>
            <p className="mt-5 text-slate-300">
              Progress through battles, sharpen your strengths, and develop a playstyle
              that reflects your own path through the world.
            </p>
          </div>
          <div
            className={cn(panelClass, "tnr-pixel-parallax p-3")}
            data-pixel-parallax="0.06"
          >
            <p className="mb-3 font-black text-amber-100 text-sm tracking-[0.18em]">
              Combat Artwork
            </p>
            <Image
              src="/screenshots/combat.webp"
              width={512}
              height={351}
              alt="Combat Artwork"
              className={screenshotClass}
            />
          </div>
        </div>
      </section>

      <section className={alternateSectionClass} data-pixel-snap="section">
        <div
          className={cn(
            containerClass,
            "grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center",
          )}
        >
          <div
            className={cn(
              panelClass,
              "tnr-pixel-parallax order-last p-3 md:order-none",
            )}
            data-pixel-parallax="0.06"
          >
            <p className="mb-3 font-black text-amber-100 text-sm tracking-[0.18em]">
              Exploration Artwork
            </p>
            <Image
              src="/screenshots/sector.webp"
              width={512}
              height={366}
              alt="Exploration Artwork"
              className={screenshotClass}
            />
          </div>
          <div>
            <p className={eyebrowClass}>Open Journey</p>
            <h2 className="mt-3 font-black font-serif text-4xl md:text-6xl">
              A world built for exploration
            </h2>
            <p className="mt-5 text-slate-300">
              Travel across locations, encounter new challenges, and experience a
              browser RPG world that feels alive beyond a single screen.
            </p>
          </div>
        </div>
      </section>

      <section id="gameplay" className={sectionClass} data-pixel-snap="section">
        <div
          className={cn(
            containerClass,
            "grid gap-8 md:grid-cols-[0.9fr_1.1fr] md:items-center",
          )}
        >
          <div>
            <p className={eyebrowClass}>Gameplay Preview</p>
            <h2 className="mt-3 font-black font-serif text-4xl md:text-6xl">
              Track your path across the realm
            </h2>
            <p className="mt-5 text-slate-300">
              Follow your journey across a connected shinobi world where villages,
              routes, and rival territories give every decision a clear sense of place.
            </p>
          </div>
          <div
            className={cn(panelClass, "tnr-pixel-parallax p-3")}
            data-pixel-parallax="0.04"
          >
            <p className="mb-3 font-black text-amber-100 text-sm tracking-[0.18em]">
              Global Map
            </p>
            <Image
              src="/screenshots/global.webp"
              width={512}
              height={372}
              alt="Global map gameplay screenshot"
              className={screenshotClass}
            />
          </div>
        </div>
      </section>

      <section id="legacy" className={alternateSectionClass} data-pixel-snap="section">
        <div className={containerClass}>
          <div className="mb-8 max-w-3xl">
            <p className={eyebrowClass}>Browser RPG Legacy</p>
            <h2 className="mt-3 font-black font-serif text-4xl md:text-6xl">
              A long-running online ninja RPG
            </h2>
            <p className="mt-5 text-slate-300">
              Join a free anime-inspired browser RPG built around villages, jutsus,
              rivalries, exploration, and long-term character progression.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "1,000,000+ Players",
                "A large shinobi community has entered The Ninja RPG across years of village conflict, combat, and progression.",
              ],
              [
                "Persistent RPG World",
                "Train your character, travel between locations, join a village, and keep building your story over time.",
              ],
              [
                "Online Since 2005",
                "A long-running browser RPG with years of player history, rivalry, updates, and community-driven play.",
              ],
              [
                "Playable in Browser",
                "Start instantly from your browser with no download required, whether you are returning or beginning fresh.",
              ],
            ].map(([title, text]) => (
              <div key={title} className={cn(panelClass, "p-5")}>
                <h3 className="font-black font-serif text-2xl text-amber-100">
                  {title}
                </h3>
                <p className="mt-3 text-slate-300 text-sm leading-6">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="community" className={sectionClass} data-pixel-snap="section">
        <div className="mx-auto flex w-[min(100%_-_32px,900px)] flex-col items-center text-center">
          <p className={eyebrowClass}>Begin the Legend</p>
          <h2 className="mt-3 font-black font-serif text-4xl md:text-6xl">
            Your Ninja Story Starts Now
          </h2>
          <p className="mt-4 max-w-2xl text-slate-300">
            Step into the world, choose your path, and begin your journey today.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className={cn(inkPrimaryButton, "tnr-ink-cta")}>
                <UserPlus className="mr-2 h-5 w-5" />
                Register
              </Button>
            </Link>
            <Link href="/login">
              <Button
                variant="outline"
                size="lg"
                className={cn(inkSecondaryButton, "tnr-ink-cta")}
              >
                Log In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-sky-100/10 border-t bg-slate-950 py-12">
        <div
          className={cn(
            containerClass,
            "grid gap-8 md:grid-cols-2 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]",
          )}
        >
          <div>
            <Image
              src={IMG_LOGO_FULL}
              width={384}
              height={138}
              alt="The Ninja RPG"
              className="h-auto w-44"
            />
            <p className="mt-4 max-w-sm text-slate-300">
              Anime-inspired browser RPG adventure, built for rivalry, mastery, and
              discovery.
            </p>
          </div>
          <div>
            <p className="font-black text-amber-100 tracking-[0.16em]">Explore</p>
            <div className="mt-4 flex flex-col gap-2 text-slate-300">
              <a href="#world" className="hover:text-amber-300">
                World
              </a>
              <a href="#features" className="hover:text-amber-300">
                Features
              </a>
              <a href="#gameplay" className="hover:text-amber-300">
                Gameplay
              </a>
              <a href="#community" className="hover:text-amber-300">
                Community
              </a>
            </div>
          </div>
          <div>
            <p className="font-black text-amber-100 tracking-[0.16em]">Game</p>
            <div className="mt-4 flex flex-col gap-2 text-slate-300">
              <Link href="/login" className="hover:text-amber-300">
                Log In
              </Link>
              <Link href="/signup" className="hover:text-amber-300">
                Register
              </Link>
              <Link href="/login/forgot-password" className="hover:text-amber-300">
                Recover Account
              </Link>
              <Link href="/rules" className="hover:text-amber-300">
                Rules
              </Link>
              <Link href="/manual/staff" className="hover:text-amber-300">
                Staff
              </Link>
            </div>
          </div>
          <div>
            <p className="font-black text-amber-100 tracking-[0.16em]">Legal</p>
            <div className="mt-4 flex flex-col gap-2 text-slate-300">
              {LEGAL_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  target={link.target}
                  rel={link.target ? "noreferrer" : undefined}
                  className="hover:text-amber-300"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
};

const McpSetupDetails = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-bold [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="border-border border-t px-4 pt-3 pb-4">{children}</div>
    </details>
  );
};

const usePixelHeaderLogoVisibility = (
  heroLogoRef: React.RefObject<HTMLElement | null>,
  scrollContainerRef: React.RefObject<HTMLElement | null>,
) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const heroLogo = heroLogoRef.current;
    if (!heroLogo) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(!entry?.isIntersecting);
      },
      {
        root: scrollContainer,
        rootMargin: "-88px 0px 0px 0px",
        threshold: 0,
      },
    );

    observer.observe(heroLogo);

    return () => {
      observer.disconnect();
    };
  }, [heroLogoRef, scrollContainerRef]);

  return isVisible;
};

const usePixelHeroVideoPlayback = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  scrollContainerRef: React.RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let isInView = true;

    const syncPlayback = (shouldPlay: boolean) => {
      if (reducedMotion.matches || !shouldPlay) {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        // Browser autoplay policies can reject play; the poster remains visible.
      });
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        isInView = entry?.isIntersecting ?? false;
        syncPlayback(isInView);
      },
      {
        root: scrollContainerRef.current,
        threshold: 0.2,
      },
    );

    const handleMotionChange = () => {
      syncPlayback(isInView);
    };

    observer.observe(video);
    reducedMotion.addEventListener("change", handleMotionChange);
    handleMotionChange();

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", handleMotionChange);
    };
  }, [videoRef, scrollContainerRef]);
};

// Bumped from "visitor_tracked" so visitors whose flag was set while the mutation was
// being rejected client-side get one more chance to be counted. Re-tracking an already
// known visitor is a no-op server-side thanks to the duplicate-key guards.
const VISITOR_TRACKED_KEY = "visitor_tracked_v2";

const SetReferal = () => {
  const searchParams = useSearchParams();
  const { isSignedIn, isLoaded } = useUser();
  const { mutate: trackVisitor } = api.misc.trackVisitor.useMutation({
    onSuccess: (result) => {
      if (result.success) safeLocalStorageSetItem(VISITOR_TRACKED_KEY, "1");
    },
  });
  useEffect(() => {
    // Set reference user
    const ref = searchParams?.get("ref");
    if (ref) safeLocalStorageSetItem("ref", ref);
    // Source
    const utm_source = searchParams?.get("utm_source");
    if (utm_source) safeLocalStorageSetItem("utm_source", utm_source);
    // Track anonymous visitor once
    const alreadyTracked = safeLocalStorageGetItem(VISITOR_TRACKED_KEY);
    if (!alreadyTracked && isLoaded && !isSignedIn) {
      const savedRef = safeLocalStorageGetItem("ref") ?? undefined;
      const savedUtm = safeLocalStorageGetItem("utm_source") ?? undefined;
      trackVisitor({ ref: savedRef, utmSource: savedUtm });
    }
  }, [searchParams, isLoaded, isSignedIn, trackVisitor]);
  return null;
};

/**
 * Texts
 */
const textSEO = (
  <div>
    <h1 className="px-2 text-left font-bold text-xl md:text-4xl">
      Free Online Ninja Browser Game
    </h1>
    <p className="p-2">
      <span className="font-bold">What is TheNinja-RPG?</span> our game is a
      browser-based online RPG set in the world of Seichi. Embark on an epic journey in
      this free ninja game where your path as a shinobi is yours to choose. Start as an
      Academy Student mastering powerful jutsu, and rise through the ranks in an
      immersive ninja game experience. Customize your character with more than 800+
      jutsus and 50+ bloodlines. Will you become a legendary Kage, protecting your
      village with ultimate ninja abilities, or choose the path of an Outlaw, mastering
      forbidden jutsu and dark arts? Your ninja adventure begins here in this unique
      multiplayer RPG world.
    </p>

    <div className="pl-2">
      <h2 className="pt-4 font-bold text-2xl">Key Features</h2>
      <p className="pb-4">
        The game features a variety of features that make it unique and engaging:
      </p>
      <ul className="flex list-outside list-disc flex-col gap-3 pl-6">
        <li>
          <h3 className="font-bold">Master Your Jutsu</h3>
          Unlock powerful jutsu, train your ninja, and create signature moves that set
          you apart in the ninja world.
        </li>
        <li>
          <h3 className="font-bold">Explore Immersive Villages</h3>
          Align with a village, enhance your reputation, and immerse yourself in a
          vibrant ninja community.
        </li>
        <li>
          <h3 className="font-bold">Engage in Strategic Ninja Battles</h3>
          Compete in intense PvP and team-based combat on a dynamic 2D hex-based
          battlefield.
        </li>
        <li>
          <h3 className="font-bold">Uncover Evolving Storylines</h3>
          Take on challenging missions, defeat rogue ninjas, and discover the hidden
          truths of the shinobi universe.
        </li>
        <li>
          <h3 className="font-bold">Join a Thriving Ninja Community</h3>
          Create clans, forge alliances, and participate in epic player-driven events
          that shape the game.
        </li>
      </ul>
    </div>
  </div>
);
