"use client";

import { BookOpen, Compass, Swords, Users } from "lucide-react";
import {
  IMG_FRONTPAGE_SCREENSHOT_COMBAT,
  IMG_FRONTPAGE_SCREENSHOT_JUTSUS,
  IMG_FRONTPAGE_SCREENSHOT_SECTOR,
  IMG_FRONTPAGE_SCREENSHOT_VILLAGE,
} from "@/drizzle/constants";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { WelcomeQuestions } from "@/layout/WelcomeQuestions";
import { getGameLayout } from "@/libs/gameLayouts";
import { useActiveLayout } from "@/utils/LayoutContext";

export function IllustratedWelcome() {
  const theme = getGameLayout(useActiveLayout());
  return (
    <>
      <section className="theme-welcome-hero" aria-label="Begin your shinobi journey">
        <div className="theme-welcome-art" aria-hidden="true" />
        <div className="theme-welcome-orbit" aria-hidden="true" />
        <div className="theme-welcome-content">
          <div className="theme-welcome-copy" data-theme-id={theme.id}>
            <h1>{theme.welcomeTitle}</h1>
            <p>Free ninja browser RPG with tactical combat and village communities.</p>
            <p>{theme.welcomeIntro}</p>
          </div>
          <div className="theme-welcome-actions">
            <Link href="/signup" id="signup_btn" className="welcome-primary-action">
              Create your ninja
            </Link>
            <a href="#world" className="welcome-secondary-action">
              <Compass aria-hidden="true" />
              Explore the world
            </a>
          </div>
          <ul className="theme-welcome-facts" aria-label="About the game">
            <li>Free to play</li>
            <li>Play in your browser</li>
            <li>Learn with Lemu</li>
          </ul>
        </div>
      </section>

      <section id="world" className="theme-welcome-world welcome-section">
        <div className="welcome-section-copy">
          <div className="welcome-section-title">
            <Compass aria-hidden="true" className="welcome-section-icon" />
            <h2>A world you can belong to</h2>
          </div>
          <p>
            Seichi is a world of villages, distant regions, and rival shinobi. Your
            character belongs to a community, but the road beyond it is yours to
            explore.
          </p>
          <p>
            Take missions, discover techniques, and build the strengths that make your
            ninja your own.
          </p>
          <Link href="/guide" className="welcome-text-link">
            Read the game guide
          </Link>
        </div>
        <figure className="welcome-world-image">
          <Image
            src={IMG_FRONTPAGE_SCREENSHOT_SECTOR}
            alt="The explorable world and travel map in The Ninja RPG"
            width={768}
            height={597}
            sizes="(min-width: 900px) 640px, 100vw"
            loading="lazy"
          />
          <figcaption>Your next mission can take you beyond the familiar.</figcaption>
        </figure>
      </section>

      <section id="gameplay" className="theme-welcome-gameplay welcome-section">
        <div className="welcome-section-heading">
          <h2>Become a shinobi through the choices you make</h2>
          <p>
            A persistent character. A growing set of techniques. Another decision every
            time you return.
          </p>
        </div>
        <div className="welcome-feature-list">
          <article className="welcome-feature">
            <div className="welcome-feature-copy">
              <Swords aria-hidden="true" />
              <h3>Read the battle</h3>
              <p>
                Choose your actions in turn-based combat. Position, equipment, and
                techniques all shape the fight.
              </p>
            </div>
            <Image
              src={IMG_FRONTPAGE_SCREENSHOT_COMBAT}
              alt="A tactical shinobi battle"
              width={768}
              height={597}
              sizes="(min-width: 1100px) 400px, 100vw"
              loading="lazy"
            />
          </article>
          <article className="welcome-feature">
            <div className="welcome-feature-copy">
              <BookOpen aria-hidden="true" />
              <h3>Develop your techniques</h3>
              <p>
                Train your stats and master jutsus. Build a style that reflects the
                shinobi you want to play.
              </p>
            </div>
            <Image
              src={IMG_FRONTPAGE_SCREENSHOT_JUTSUS}
              alt="Jutsu techniques available to train and equip"
              width={768}
              height={597}
              sizes="(min-width: 1100px) 400px, 100vw"
              loading="lazy"
            />
          </article>
          <article className="welcome-feature">
            <div className="welcome-feature-copy">
              <Users aria-hidden="true" />
              <h3>Find your people</h3>
              <p>
                Join village life, meet players at the tavern, and work toward shared
                goals with a clan or squad.
              </p>
            </div>
            <Image
              src={IMG_FRONTPAGE_SCREENSHOT_VILLAGE}
              alt="The buildings and gathering places of a shinobi village"
              width={768}
              height={597}
              sizes="(min-width: 1100px) 400px, 100vw"
              loading="lazy"
            />
          </article>
        </div>
      </section>

      <section id="community" className="theme-welcome-community welcome-section">
        <div>
          <h2>Your first chapter starts at the academy</h2>
          <p>
            Lemu introduces the controls, training, battles, and the wider world. Start
            with the basics and discover the rest as your character grows.
          </p>
        </div>
        <div className="welcome-community-actions">
          <Link href="/signup" className="welcome-primary-action">
            Start your journey
          </Link>
          <Link href="/forum" className="welcome-secondary-action">
            Meet the community
          </Link>
        </div>
      </section>
      <WelcomeQuestions />
    </>
  );
}
