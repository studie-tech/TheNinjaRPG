import Link from "@/layout/Link";

/** Answers the practical questions visitors have before creating their first ninja. */
export function WelcomeQuestions() {
  return (
    <section
      aria-labelledby="welcome-questions"
      className="mx-auto my-6 w-full max-w-3xl rounded-xl bg-popover p-6 text-foreground"
    >
      <h2 id="welcome-questions" className="font-bold text-2xl">
        Getting started with our ninja browser RPG
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <h3 className="font-bold">Is TheNinja-RPG free to play?</h3>
          <p>
            Yes. You can create a ninja, train jutsu, complete missions and battle other
            players for free. Optional purchases are available in the game.
          </p>
        </div>
        <div>
          <h3 className="font-bold">Do I need to download anything?</h3>
          <p>
            No download is required. Play in a web browser on your phone, tablet or
            computer using the same account.
          </p>
        </div>
        <div>
          <h3 className="font-bold">What kind of game is TheNinja-RPG?</h3>
          <p>
            It is an anime-inspired multiplayer RPG set in Seichi. Develop a persistent
            character, master jutsu, explore the world and fight tactical, turn-based
            battles. Join a village and meet players through clans, the tavern and
            community events.
          </p>
        </div>
        <div>
          <h3 className="font-bold">How do I learn to play?</h3>
          <p>
            Create an account and a character to begin at the academy. Lemu guides your
            first steps through training and combat. You can also read the{" "}
            <Link href="/guide/getting-started" className="font-bold underline">
              getting started guide
            </Link>{" "}
            and explore the{" "}
            <Link href="/manual" className="font-bold underline">
              game manual
            </Link>
            .
          </p>
        </div>
      </div>
      <Link href="/signup" className="mt-5 inline-block font-bold underline">
        Create your ninja for free
      </Link>
    </section>
  );
}
