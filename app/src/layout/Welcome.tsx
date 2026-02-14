"use client";

import { useUser } from "@clerk/nextjs";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { Suspense, useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  IMG_FRONTPAGE_SCREENSHOT_COMBAT,
  IMG_FRONTPAGE_SCREENSHOT_GLOBAL,
  IMG_FRONTPAGE_SCREENSHOT_JUTSUS,
  IMG_FRONTPAGE_SCREENSHOT_SECTOR,
  IMG_FRONTPAGE_SCREENSHOT_VILLAGE,
  IMG_LAYOUT_WELCOME_IMG,
} from "@/drizzle/constants";
import { env } from "@/env/client.mjs";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";

const Welcome: React.FC = () => {
  // Snap container for full-height sections
  const backgroundClass = cn(
    "flex flex snap-start snap-always flex-col justify-center gap-4",
  );

  // Content wrapper with background styling
  const contentClass = cn(
    "mr-auto ml-auto flex w-[99%] max-w-[768px] flex-col items-center rounded-xl bg-popover/75",
  );

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
              More than <b>{(1000000).toLocaleString()}</b> have played TheNinja-RPG!
            </p>
            <p>Join the new version and experience our ninja world!</p>
            <Link href="/signup" aria-label="Signup" className="m-3 w-full p-3">
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
        <div className="mb-4 flex flex-col gap-4">
          <div
            className={cn(backgroundClass, "pl-3 font-bold text-5xl text-foreground")}
          >
            AI Agent Instructions
          </div>
          <div className={backgroundClass}>
            <div className={contentClass}>
              <div className="w-full p-3">
                <div className="flex flex-col gap-4">
                  <h2 className="font-bold text-2xl">Play with AI Assistants</h2>
                  <p>
                    TheNinja-RPG supports the Model Context Protocol (MCP), allowing AI
                    assistants like Claude, ChatGPT, and Cursor to interact with the
                    game on your behalf. Train your ninja, manage your village, engage
                    in combat, and more - all through natural language conversations
                    with your AI assistant.
                  </p>

                  <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <h3 className="mb-2 font-bold text-lg">MCP Server URL</h3>
                    <code className="block rounded bg-background p-3 font-mono text-sm">
                      {env.NEXT_PUBLIC_BASE_URL}/api/mcp
                    </code>
                  </div>

                  <div className="flex flex-col gap-3">
                    <h3 className="font-bold text-xl">Setup Instructions</h3>

                    <div className="rounded-lg border border-border p-4">
                      <h4 className="mb-2 font-bold">Claude Code (CLI)</h4>
                      <p className="mb-2 text-sm">
                        Add the MCP server using the Claude Code settings command:
                      </p>
                      <code className="block rounded bg-background p-3 font-mono text-xs">
                        claude mcp add --transport http theninja-rpg{" "}
                        {env.NEXT_PUBLIC_BASE_URL}/api/mcp
                      </code>
                    </div>

                    <div className="rounded-lg border border-border p-4">
                      <h4 className="mb-2 font-bold">Claude Desktop</h4>
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
                    </div>

                    <div className="rounded-lg border border-border p-4">
                      <h4 className="mb-2 font-bold">Cursor / VS Code</h4>
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
                    </div>
                  </div>

                  <p className="text-muted-foreground text-sm">
                    When you first connect, you&apos;ll be prompted to authenticate with
                    your TheNinja-RPG account via Clerk OAuth. This allows the AI
                    assistant to perform actions on your behalf securely.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className={cn(backgroundClass, "pl-3 font-bold text-5xl text-foreground")}>
        Game Features
      </div>

      <div className={backgroundClass}>
        <div className={contentClass}>
          <div className="w-full p-3">
            <div className="flex flex-col gap-2">
              <h2 className="font-bold text-2xl">Jutsus</h2>
              <p>
                Jutsu are the cornerstone of strategic combat, blending skill,
                creativity, and tactical planning to overcome your opponents. Players
                can harness the power of chakra to unleash a variety of techniques,
                including Ninjutsu, Genjutsu, and Taijutsu, each offering unique combat
                advantages.
              </p>
              <p>
                By mastering intricate hand seals and managing your chakra reserves, you
                can develop devastating combos, counter enemy moves, and dominate the
                battlefield. Explore thousands of potential jutsu combinations and
                refine your strategy to suit your playstyle—whether you prefer brute
                strength, deception, or finesse.
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
                requiring players to carefully plan their moves, manage resources, and
                outthink their opponents.
              </p>
              <p>
                Choose from a wide arsenal of techniques, including powerful jutsu,
                precise attacks, and defensive maneuvers, to adapt to any situation.
                Each round challenges you to anticipate your opponent&apos;s strategy
                while leveraging your unique abilities and character build. Timing,
                positioning, and strategy are key as you engage in battles that demand
                both tactical decision-making and foresight.
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
                The ninja village is your home, your sanctuary, and the center of your
                growth as a shinobi. This bustling hub is where strategy meets daily
                life, offering countless opportunities to sharpen your skills, manage
                your resources, and engage with fellow ninjas.
              </p>
              <p>
                From training grounds that push your abilities to the limit, to the
                ramen shop where you replenish your stamina, every corner of the village
                plays a vital role in your journey. The village bank ensures your
                hard-earned wealth is protected, while the item shop equips you with
                tools and scrolls to gain an edge in combat. In the clan hall,
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
                Travel isn&apos;t just about getting from one place to another—it&apos;s
                a core part of the game&apos;s experience. Whether you&apos;re scouting
                enemy territories, setting up ambushes, or evading rival ninjas, the 2D
                system gives you the freedom to plan your movements and adapt on the
                fly. Players can launch surprise attacks, defend key locations, or
                simply traverse the map to reach mission objectives and hidden rewards.
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
                The 3D global travel system expands your journey beyond your village,
                opening the gates to a vast world filled with diverse regions and hidden
                secrets. Travel between villages, explore distant lands, and immerse
                yourself in the rich lore of the ninja universe.
              </p>
              <p>
                Global travel isn&apos;t just about exploration—it&apos;s an opportunity
                to engage with new challenges and alliances. Visit other villages to
                trade, forge alliances, or test your strength against foreign rivals.
                Each region offers unique environments, from dense forests and sprawling
                deserts to snow-capped mountains, each presenting its own set of
                opportunities and dangers.
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
      <Suspense>
        <SetReferal />
      </Suspense>
    </div>
  );
};

export default Welcome;

function SetReferal() {
  const searchParams = useSearchParams();
  const { isSignedIn, isLoaded } = useUser();
  const { mutate: trackVisitor } = api.misc.trackVisitor.useMutation({
    onMutate: undefined,
  });
  useEffect(() => {
    // Set reference user
    const ref = searchParams?.get("ref");
    if (ref) safeLocalStorageSetItem("ref", ref);
    // Source
    const utm_source = searchParams?.get("utm_source");
    if (utm_source) safeLocalStorageSetItem("utm_source", utm_source);
    // Track anonymous visitor once
    const alreadyTracked = safeLocalStorageGetItem("visitor_tracked");
    if (!alreadyTracked && isLoaded && !isSignedIn) {
      const savedRef = safeLocalStorageGetItem("ref") ?? undefined;
      const savedUtm = safeLocalStorageGetItem("utm_source") ?? undefined;
      trackVisitor({ ref: savedRef, utmSource: savedUtm });
      safeLocalStorageSetItem("visitor_tracked", "1");
    }
  }, [searchParams, isLoaded, isSignedIn, trackVisitor]);
  return null;
}

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
