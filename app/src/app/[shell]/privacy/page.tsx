import {
  DISCORD_INDEFINITE_SANCTION_DAYS,
  DISCORD_MAX_CHARACTERS_PER_ACCOUNT,
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { LEGAL_LINKS } from "@/libs/legalLinks";

const PRIVACY_POLICY_URL = LEGAL_LINKS.find(
  (link) => link.label === "Privacy Policy",
)?.href;

/**
 * Plain-language privacy details for individual game features. The full Privacy Policy is
 * hosted externally (see LEGAL_LINKS); this page adds what that document cannot cover in
 * feature detail.
 */
export default function Privacy() {
  return (
    <ContentBox title="Privacy" subtitle="How game features use your data">
      <div>
        <p className="my-2">
          Our full{" "}
          {PRIVACY_POLICY_URL ? (
            <Link className="font-bold" href={PRIVACY_POLICY_URL}>
              Privacy Policy
            </Link>
          ) : (
            "Privacy Policy"
          )}{" "}
          describes how <b>TheNinja-RPG</b> (&quot;TNR&quot;) handles your data. This
          page explains specific game features in plain language.
        </p>
        <p className="my-2 text-muted-foreground text-sm">
          Last updated: 25 October 2026
        </p>
        <hr className="my-2" />

        <h2 id="discord" className="font-bold text-lg">
          Discord account linking
        </h2>
        <p className="my-2">
          Linking a Discord account is optional. Nothing below happens unless you link
          one from your profile settings or the{" "}
          <Link className="font-bold" href="/discord/link">
            Discord link page
          </Link>
          .
        </p>

        <h3 className="pt-3 font-bold text-md">What we receive from Discord</h3>
        <ul className="list-disc pl-5">
          <li>
            Your Discord user ID and username. The date your Discord account was created
            is read from the ID; accounts must be at least{" "}
            {DISCORD_MIN_ACCOUNT_AGE_DAYS} days old to link.
          </li>
          <li>
            The permissions you approve: <b>identify</b> (your Discord ID and username),{" "}
            <b>role_connections.write</b> (to grant the Verified Ninja role through
            Discord Linked Roles) and <b>guilds.join</b> (to add you to the TNR Discord
            server if you are not a member yet).
          </li>
          <li>
            If you sign in to TNR with Discord, we may reuse that sign-in&apos;s
            existing Discord authorization instead of showing you a second consent
            screen. That sign-in already shares your email address with TNR when you log
            in; linking stores nothing extra.
          </li>
        </ul>

        <h3 className="pt-3 font-bold text-md">What we never receive or store</h3>
        <p className="my-2">
          Discord never gives us your password, payment details or IP address, and we do
          not access your messages, friends list or other servers. Linking does not send
          your email, IP address or payment details to Discord. Purchases are paid
          through PayPal, Stripe or the app stores, which handle your card details; TNR
          does not store card numbers, and Discord linking has no connection to
          payments.
        </p>

        <h3 className="pt-3 font-bold text-md">What we store</h3>
        <ul className="list-disc pl-5">
          <li>
            The link: Discord ID, username, account creation date, when you linked, how
            you linked (Discord consent screen or Discord sign-in) and the permissions
            granted.
          </li>
          <li>
            For links made through the Discord consent screen, the Discord access and
            refresh tokens, encrypted. Links made from your Discord sign-in store no
            token; our sign-in provider (Clerk) keeps it.
          </li>
          <li>
            If you sign in with Discord, the ID of that Discord account, so staff are
            alerted when it differs from the linked one.
          </li>
          <li>
            Sync status: the character name, village, level and ban status last sent to
            Discord, and any sync error.
          </li>
          <li>Moderation log entries for linking and unlinking.</li>
        </ul>

        <h3 className="pt-3 font-bold text-md">What we send to Discord</h3>
        <ul className="list-disc pl-5">
          <li>Your server nickname: your character name.</li>
          <li>Roles: Verified Ninja and your village role.</li>
          <li>
            Linked Roles data: that you are linked, your character name and level.
          </li>
          <li>
            A server ban while a linked character has an indefinite ban or silence in
            the game (one of {DISCORD_INDEFINITE_SANCTION_DAYS} days or more). The ban
            reason names the TNR report number, and the ban is lifted when the sanction
            ends.
          </li>
        </ul>

        <h3 className="pt-3 font-bold text-md">Who can see it</h3>
        <p className="my-2">
          Other players cannot see your Discord account through TNR. Moderators can see
          which Discord account is linked to which characters, including past links, to
          enforce the rules. One Discord account can be linked to at most{" "}
          {DISCORD_MAX_CHARACTERS_PER_ACCOUNT} characters, and staff see those
          characters as having the same owner.
        </p>

        <h3 className="pt-3 font-bold text-md">Unlinking and how long we keep data</h3>
        <ul className="list-disc pl-5">
          <li>
            Unlink at any time under <b>Discord</b> in your profile settings. This
            removes the nickname and roles we manage, tells Discord you are no longer
            linked and revokes our token. It usually takes effect right away, but can
            take a little longer if Discord is unavailable. If another character stays
            linked, Discord follows that character instead. Unlinking is not possible
            while an indefinite ban or silence runs.
          </li>
          <li>
            After unlinking, a history record (Discord ID, username, character, link and
            unlink times) is kept to enforce the {DISCORD_UNLINK_COOLDOWN_DAYS}-day
            relink cooldown and prevent abuse, also when you delete your character.
          </li>
          <li>
            If you delete your account while a ban or silence is running, a scrambled
            (hashed) copy of the linked Discord ID is kept with the sanction until it
            ends, so a new account cannot use it to get around the sanction.
          </li>
        </ul>
      </div>
    </ContentBox>
  );
}
