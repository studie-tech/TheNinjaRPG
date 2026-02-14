import Head from "next/head";
import type React from "react";

const Header: React.FC = () => {
  return (
    <Head>
      <title>The Ninja-RPG.com - a free browser based mmorpg</title>
      <meta
        name="description"
        content="A free browser based game set in the ninja world of the Seichi. A multiplayer game with 2D travel and combat system"
      />
      <meta
        name="keywords"
        content="mmorpg, online, rpg, game, anime, manga, strategy, multiplayer, ninja, community, core 3, theninja-rpg"
      />
      <meta name="author" content="Mathias F. Gruber"></meta>
      <meta name="distribution" content="Global" />
      <meta name="copyright" content="TheNinja-RPG.com" />
      <meta name="revisit-after" content="1 day" />
      <meta name="viewport" content="width=device-width, initial-scale=1"></meta>
      <link rel="icon" href="/favicon.ico" />

      {/* Google search verification */}
      <meta
        name="google-site-verification"
        content="0yl4KCd6udl9DAo_TMf8esN6snWH0_gqwf2EShlogRU"
      />

      {/* Social Media Sharing */}
      <meta property="og:url" content="https://www.theninja-rpg.com"></meta>
      <meta property="og:type" content="website"></meta>
      <meta property="og:title" content="TheNinja-RPG"></meta>
      <meta
        property="og:description"
        content="A free browser based game set in the ninja world of the Seichi. A multiplayer game with 2D travel and combat system"
      ></meta>
      <meta property="og:image" content="<generated>" />
      <meta property="og:image:alt" content="TheNinja-RPG Logo" />
      <meta property="og:image:type" content="image/png" />
      <meta
        name="twitter:title"
        content="The Ninja-RPG.com - a free browser based mmorpg"
      ></meta>
      <meta
        name="twitter:description"
        content="A free browser based game set in the ninja world of the Seichi. A multiplayer game with 2D travel and combat system"
      ></meta>
    </Head>
  );
};

export default Header;
