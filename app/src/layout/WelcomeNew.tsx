"use client";

import React, { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { UserPlus, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { IMG_LAYOUT_WELCOME_IMG } from "@/drizzle/constants";
import { IMG_FRONTPAGE_SCREENSHOT_COMBAT } from "@/drizzle/constants";
import { IMG_FRONTPAGE_SCREENSHOT_JUTSUS } from "@/drizzle/constants";
import { IMG_FRONTPAGE_SCREENSHOT_GLOBAL } from "@/drizzle/constants";
import { IMG_FRONTPAGE_SCREENSHOT_SECTOR } from "@/drizzle/constants";
import { IMG_FRONTPAGE_SCREENSHOT_VILLAGE } from "@/drizzle/constants";
import { api } from "@/app/_trpc/client";
import { useUser } from "@clerk/nextjs";

const WelcomeNew: React.FC = () => {
  // Render
  return (
    <>
      <div className="flex flex-col ">
        <Image
          className=""
          src={IMG_LAYOUT_WELCOME_IMG}
          alt="TNR Logo"
          width={1000}
          height={181}
          priority
        />
        <div className="text-sm sm:text-md sm:text-md md:text-md lg:text-xl flex flex-col text-center items-center gap-0 px-4 italic py-4">
          <p>
            More than <b>{(1000000).toLocaleString()}</b> people have played
            TheNinja-RPG!
          </p>
          <p>Join the new version and experience our unique ninja world!</p>
        </div>
        <div className="w-full flex flex-col justify-center items-center py-3 gap-4 ">
          <Link href="/signup" aria-label="Signup" className="w-full px-3">
            <Button
              id="signup_btn"
              className="font-bold w-full text-xl"
              size="xl2"
              animation="glow"
            >
              <UserPlus className="h-6 w-6 mr-2" />
              Create an Account
            </Button>
          </Link>
          <div className="inline items-center gap-2">
            Already have an account?{" "}
            <Link href="/login" aria-label="Login" className="text-primary font-bold">
              Log In
            </Link>
          </div>
        </div>
        <div className="py-6 w-full px-3">
          <hr className="h-px border-primary border-2" />
        </div>
        <h1 className="text-left text-xl md:text-4xl font-bold px-2">
          Free Online Ninja Browser Game
        </h1>
        <p className="p-2">
          <span className="font-bold">What is TheNinja-RPG?</span> our game is a
          browser-based online RPG set in the world of Seichi. Embark on an epic journey
          in this free ninja game where your path as a shinobi is yours to choose. Start
          as an Academy Student mastering powerful jutsu, and rise through the ranks in
          an immersive ninja game experience. Customize your character with more than
          800+ jutsus and 50+ bloodlines. Will you become a legendary Kage, protecting
          your village with ultimate ninja abilities, or choose the path of an Outlaw,
          mastering forbidden jutsu and dark arts? Your ninja adventure begins here in
          this unique multiplayer RPG world.
        </p>

        <div className="pl-2">
          <h2 className="text-2xl font-bold pt-4">Key Features</h2>
          <p className="pb-4">
            The game features a variety of features that make it unique and engaging:
          </p>
          <ul className="list-disc list-outside pl-6 flex flex-col gap-3">
            <li>
              <h3 className="font-bold">Master Your Jutsu</h3>
              Unlock powerful jutsu, train your ninja, and create signature moves that
              set you apart in the ninja world.
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
              Create clans, forge alliances, and participate in epic player-driven
              events that shape the game.
            </li>
          </ul>

          <div className="w-full p-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-bold pt-4">Jutsus</h2>
              <Image
                src={IMG_FRONTPAGE_SCREENSHOT_JUTSUS}
                width={1024}
                height={716}
                className="w-full rounded-xl"
                alt="Screenshot from Jutsus"
              />
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
              <h2 className="text-2xl font-bold pt-4">Combat</h2>
              <Image
                src={IMG_FRONTPAGE_SCREENSHOT_COMBAT}
                width={1024}
                height={702}
                className="w-full rounded-xl"
                alt="Screenshot from Combat"
              />
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
              <h2 className="text-2xl font-bold pt-4">Village</h2>
              <Image
                src={IMG_FRONTPAGE_SCREENSHOT_VILLAGE}
                width={1024}
                height={679}
                className="w-full rounded-xl"
                alt="Screenshot from Village"
              />
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
              <h2 className="text-2xl font-bold pt-4">Sectors</h2>
              <Image
                src={IMG_FRONTPAGE_SCREENSHOT_SECTOR}
                width={1024}
                height={732}
                className="w-full rounded-xl"
                alt="Screenshot from Sector"
              />
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
              <h2 className="text-2xl font-bold pt-4">Travel</h2>
              <Image
                src={IMG_FRONTPAGE_SCREENSHOT_GLOBAL}
                width={1024}
                height={743}
                className="w-full rounded-xl"
                alt="Screenshot from Jutsus"
              />
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
            </div>
          </div>
        </div>
      </div>
      <Suspense>
        <SetReferal />
      </Suspense>
    </>
  );
};

export default WelcomeNew;

function SetReferal() {
  const searchParams = useSearchParams();
  const { isSignedIn, isLoaded } = useUser();
  const { mutate: trackVisitor } = api.misc.trackVisitor.useMutation({
    onMutate: undefined,
  });
  useEffect(() => {
    // Set reference user
    const ref = searchParams?.get("ref");
    if (ref) localStorage.setItem("ref", ref);
    // Source
    const utm_source = searchParams?.get("utm_source");
    if (utm_source) localStorage.setItem("utm_source", utm_source);
    // Track anonymous visitor once
    const alreadyTracked = localStorage.getItem("visitor_tracked");
    if (!alreadyTracked && isLoaded && !isSignedIn) {
      const savedRef = localStorage.getItem("ref") ?? undefined;
      const savedUtm = localStorage.getItem("utm_source") ?? undefined;
      trackVisitor({ ref: savedRef, utmSource: savedUtm });
      localStorage.setItem("visitor_tracked", "1");
    }
  }, [searchParams, isLoaded, isSignedIn, trackVisitor]);
  return null;
}
