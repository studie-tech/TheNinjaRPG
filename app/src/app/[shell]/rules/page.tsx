import type React from "react";
import ContentBox from "@/layout/ContentBox";
import { GuideToc } from "@/layout/GuideArticleView";

export default function GameRules() {
  return (
    <ContentBox title="Game Rules">
      <div>
        <p className="my-2">
          Welcome to <b>TheNinja-RPG</b> (also referred to as &quot;TNR&quot; or
          &quot;the game&quot;). By participating in TNR, you agree to comply with the
          rules and terms outlined below. These rules are designed to ensure a fair,
          respectful, and enjoyable environment for all players. Violations of these
          terms may result in immediate action by the moderation team, up to and
          including permanent account bans. Users are considered solely responsible for
          the actions and content of their account. Any action attributed to someone
          else accessing their account is the responsibility of the account owner. TNR
          generally follows PEGI-12 guidelines for game content, however user content is
          unrated.
        </p>
        <nav aria-label="On this page" className="my-3 rounded-lg border p-3">
          <p className="font-bold">On this page</p>
          <GuideToc headings={RULE_TOC} />
        </nav>
        <hr className="my-2" />

        <RuleHeading number="1" />
        <RuleHeading number="1.1" />
        <p className="my-2 pl-3">
          To maintain a welcoming environment, all users are required to treat others
          with respect and dignity. When encountering negative behavior users are
          strongly encouraged to use the blacklist feature in addition to reporting an
          offense. The following behaviors are strictly prohibited:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <b>Harassment:</b> Targeted insults, threats, or abuse directed at another
            player or staff member.
          </li>
          <li>
            <b>Offensive Language:</b> Use of racist, sexist, discriminatory, obscene,
            or otherwise offensive language. Moderate use of profanity is allowed (as
            long as it is not reported as harassment); however, excessive or aggressive
            use directed at others is not. These rules apply equally to all players.
          </li>
          <li>
            <b>Trolling:</b> Intentional incitement of negative responses or disruption
            of community spaces.
          </li>
          <li>
            <b>Prohibited Topics:</b> Discussions involving sexual content, political
            issues, widely illegal drugs, religion, sensitive issues (e.g., suicide), or
            ongoing court cases in public forums or the Tavern.
          </li>
          <li>
            <b>External Harassment:</b> Personal harassment of TNR community members
            outside the game, if reported and verified, will be addressed within the
            rules <b>if deemed exceptional or extreme</b>. (e.g stalking, extreme sexual
            harassment, blackmail)
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="2" />
        <ul className="list-disc pl-5">
          <li>
            <b>Prohibited Content:</b> Avatars, account names, and titles depicting
            politically offensive (for example but not limited to: mocking or demeaning
            current political parties and politicians), religiously demeaning, and
            sexually explicit content, and references to widely illegal drugs or guns
            are prohibited. Mildly provocative avatars are allowed. Good rule: If it’s
            safe to show on Naruto, it is fine on TNR.
          </li>
          <li>
            <b>Disruptive Designs, Names, and Titles:</b> Avatars designed to annoy,
            offend, or disrupt the community are prohibited.
          </li>
          <li>
            <b>Staff Requests:</b> Moderators may request avatar changes to maintain
            community standards. Requests must be respected. If you wish to challenge
            the request, please follow moderator instructions and appeal. Moderators may
            help in suggesting changes which may make the avatar acceptable to community
            standards.
          </li>
          <li>
            <b>Forced Changes:</b> Names, avatars, or titles deemed inappropriate may be
            changed without prior notification. Reputation points lost due to these
            changes will not be refunded unless the action is deemed to be in error by a
            moderator. As with avatars, please follow moderator instructions and appeal
            if you think the request was inaccurate or in error.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="3" />
        <ul className="list-disc pl-5">
          <li>
            <b>Prohibited Platforms:</b> Links to sites associated with drugs,
            pornography, hate speech, or harmful content are forbidden.
          </li>
          <li>
            <b>Appropriate Content:</b> Shared links must align with TNR’s community
            standards. Misuse will result in disciplinary action.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="4" />
        <RuleHeading number="4.1" />
        <p className="my-2 pl-3">
          Strikes do not reset and remain permanently attached to a user’s record.
          Moderators typically issue one official warning before applying a strike,
          unless the violation is severe. A moderator may issue an unofficial warning or
          rule reminder before issuing a strike or official warning. However, it is
          considered a courtesy and is not required before official action is taken.
        </p>

        <RuleHeading number="4.2" />
        <ul className="list-disc pl-5">
          <li>
            <b>Strike 1:</b> 24-hour Silence.
          </li>
          <li>
            <b>Strike 2:</b> 72-hour Silence.
          </li>
          <li>
            <b>Strike 3:</b> 1-week Silence
          </li>
          <li>
            <b>Strike 4:</b> 1-month Silence. Appeals are allowed but rarely granted
            without substantial proof of error.
          </li>
          <li>
            <b>Escalation:</b> Violations beyond 4 strikes may lead to a permanent
            Silence or Ban.
          </li>
        </ul>

        <RuleHeading number="4.3" />
        <ul className="list-disc pl-5">
          <li>
            <b>Minimum Duration:</b> Silences under 24 hours are not considered strikes.
          </li>
          <li>
            <b>Bans:</b> Bans count as 2 strikes. A 3rd ban could lead to a permanent
            ban.
          </li>
          <li>
            <b>Immediate Action:</b> Severe violations (e.g., hate speech, threats,
            doxxing, sexual harassment) may result in immediate silences or bans,
            possibly permanent.
          </li>
          <li>
            Abuse of bugs and game play mechanics will result in a ban instead of a
            silence. Game abuse will not be tolerated. Users may not be given a warning
            if the abuse is believed to be intentional.
          </li>
          <li>
            Strikes for punishments that have been completed may be removed, under
            review, after a year of good behaviour. However removal is not guaranteed.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="5" />
        <RuleHeading number="5.1" />
        <ul className="list-disc pl-5">
          <li>Users should report rule violations via the in-game reporting system.</li>
          <li>
            Reports must include relevant evidence. Abuse of the system may result in
            penalties (including but not limited to a silence and/or 1 strike) for the
            reporting user.
          </li>
          <li>
            Screenshots and grabs may be submitted as evidence however the use of them
            is at the discretion of the moderation staff and may be dismissed due to the
            ability to alter images. Users are encouraged to use the official reporting
            feature as it is the most reliable evidence.
          </li>
        </ul>

        <RuleHeading number="5.2" />
        <ul className="list-disc pl-5">
          <li>
            Users may appeal disciplinary actions by contacting the issuing Moderator or
            Head Moderator.
          </li>
          <li>
            Appeals require substantial evidence and are rarely granted for permanent
            bans.
          </li>
          <li>
            Appeals may also be made through discord using a moderation ticket. However
            this process is subject to change.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="6" />
        <RuleHeading number="6.1" />
        <ul className="list-disc pl-5">
          <li>
            <b>Jr. Moderators:</b> Moderators in training. May issue warnings and
            silences.
          </li>
          <li>
            <b>Moderators:</b> Address immediate issues and primarily enforce silences.
            May issue bans.
          </li>
          <li>
            <b>Head Moderator:</b> Oversees escalations, appeals, and issues bans and
            silences.
          </li>
          <li>
            <b>Moderator Admin:</b> Manages the moderation team and resolves internal
            complaints regarding moderation staff.
          </li>
          <li>
            <b>Content Staff:</b> Ensures in-game balance and addresses bugs.
          </li>
          <li>
            <b>Event Staff:</b> Creates lore, event imagery, and manages events.
          </li>
          <li>
            <b>Content Admin:</b> Directs content and event staff to help ensure
            cohesive gameplay and balancing. Resolves internal complaints regarding
            content and event staff.
          </li>
          <li>
            <b>Coder:</b> Responsible for fixing bugs and creating game features.
          </li>
          <li>
            <b>Site Owner:</b> Terriator is owner of TNR and the final appeal of all
            complaints and paypal issues.
          </li>
        </ul>

        <RuleHeading number="6.2" />
        <ul className="list-disc pl-5">
          <li>
            <b>Transparency:</b> All disciplinary actions must be logged and justified.
          </li>
          <li>
            <b>Rules Apply to Staff:</b> Staff are held to every rule on this page in
            the same way as players. A staff role does not grant any exemption.
          </li>
        </ul>

        <RuleHeading number="6.3" />
        <p className="my-2 pl-3">
          Staff may not use staff powers, tools, or influence (including moderation
          actions, content and balance changes, reward or item grants, and access to
          private information) in any matter where they have a conflict of interest. A
          conflict of interest exists whenever the matter involves:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <b>Their Own Accounts:</b> Any account they own, control, have ever shared,
            or play on, including secondary accounts (alts), whether or not the account
            is currently active.
          </li>
          <li>
            <b>Connected Players:</b> Accounts belonging to family members, people in
            the same household or on the same IP, or anyone whose account they have
            access to.
          </li>
          <li>
            <b>Their Village, Clan, or Faction:</b> The village, clan, ANBU squad,
            faction, or any other group the staff member (or any of their accounts)
            belongs to or has belonged to within the last 30 days.
          </li>
          <li>
            <b>Players in Conflict:</b> Any player they are, or have recently been, in a
            personal dispute, argument, feud, or in-game rivalry with, and any player
            who has reported them or whom they have reported.
          </li>
        </ul>
        <p className="my-2 pl-3">When a conflict of interest exists, staff must:</p>
        <ul className="list-disc pl-5">
          <li>
            Not act on the matter themselves, and hand it to an unconflicted staff
            member in the same area (moderation or content) with the same or higher
            role. If no such staff member is available, escalate to the relevant Admin
            (Moderator Admin or Content Admin) or, failing that, the Site Owner.
          </li>
          <li>
            Disclose the conflict when handing it over, so the reviewing staff member
            has full context.
          </li>
          <li>
            Treat any doubt as a conflict. If a staff member is unsure whether a
            conflict exists, they must recuse themselves and ask a Head Moderator,
            Moderator Admin, or Content Admin.
          </li>
        </ul>
        <p className="my-2 pl-3">
          These rules are applied by their intent, not only their wording. Actions that
          benefit a staff member&apos;s own accounts or groups indirectly (for example,
          a balance change made to favor their own build, or asking another staff member
          to act on their behalf) are treated as violations.
        </p>

        <RuleHeading number="6.4" />
        <p className="my-2 pl-3">
          When a staff member is the target of harassment, baiting, or hostility, they
          must:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <b>Disengage:</b> Stop responding to the player in public spaces and avoid
            escalating the situation.
          </li>
          <li>
            <b>Tag a Moderator:</b> Ask another moderator, who has no conflict of
            interest, to handle the situation.
          </li>
          <li>
            <b>Report:</b> Use the in-game report feature so reliable evidence is
            recorded.
          </li>
        </ul>
        <p className="my-2 pl-3">
          Staff may never punish, silence, ban, or otherwise act against a player who is
          harassing or arguing with them personally.
        </p>

        <RuleHeading number="6.5" />
        <ul className="list-disc pl-5">
          <li>
            Staff may be placed on probation when joining or changing role, or after a
            conduct issue. The terms and length of the probation (typically 90 days) are
            communicated to the staff member in writing.
          </li>
          <li>
            A single breach of the recusal rules, the harassment protocol, or the
            probation terms during probation ends the staff member&apos;s role.
          </li>
          <li>
            Outside of probation, breaches of these rules may lead to a warning,
            demotion, or removal from staff, in addition to any normal punishment under
            section 4.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="7" />
        <RuleHeading number="7.1" />
        <ul className="list-disc pl-5">
          <li>
            Exploiting mechanics or using unauthorized third-party tools is prohibited.
            Using an API or MCP client to access TNR&apos;s official MCP server as
            permitted by section 7.4 is authorized. This does not authorize exploits or
            bypassing game restrictions.
          </li>
          <li>
            Punishment escalates from temporary bans to permanent bans for repeated
            offenses.
          </li>
        </ul>

        <RuleHeading number="7.2" />
        <ul className="list-disc pl-5">
          <li>
            Each individual may own up to two accounts in total, including accounts
            played by AI. Using multiple agents or API clients does not increase this
            limit.
          </li>
          <li>
            Each account must have one human owner. Owner-authorized AI play permitted
            by section 7.4 does not count as sharing an account with another player.
            Multiple accounts on the same IP must be reported to moderators to avoid
            penalties. A shared IP, including shared API hosting, does not by itself
            establish account sharing or common ownership.
          </li>
          <li>
            Sharing accounts between human players is prohibited, including players on
            the same IP. If this is proven, it may lead to a warning or ban of all
            shared accounts.
          </li>
          <li>
            If an individual is found to own more than two accounts, the owner will be
            asked to mark the accounts exceeding this limit for deletion. Failure to do
            so may result in bans on all their accounts. Users will be given a 24hr
            window to reply to the request before action will be taken.
          </li>
          <li>
            The killing of one’s own secondary account, as well as the coordinated
            farming of another user’s alt, is prohibited. Players caught doing so may
            receive a warning or ban.
          </li>
        </ul>

        <RuleHeading number="7.3" />
        <ul className="list-disc pl-5">
          <li>Strictly prohibited and may result in permanent bans.</li>
        </ul>

        <RuleHeading number="7.4" />
        <ul className="list-disc pl-5">
          <li>
            <b>Same Rules:</b> AI players and players using AI assistance must follow
            all game rules, including account limits, fair play, and conduct rules. The
            official API permission below does not waive these obligations.
          </li>
          <li>
            <b>Identification and Responsibility:</b> Accounts played by an AI must
            clearly identify themselves as AI players in their public profile and be
            reported to moderators with their human owner identified. The human owner
            remains responsible for all actions and content of the account.
          </li>
          <li>
            <b>Official API:</b> With authorization from their human owner, AI players
            may choose and execute game actions through TNR&apos;s official API (the MCP
            server at /api/mcp) without the owner approving each action or remaining
            continuously present. This allowance covers every endpoint exposed by that
            server that the account is authorized to use under its normal access checks
            and gameplay prerequisites; there is no separate AI-only endpoint ban.
            Follow the server&apos;s rate limits and game cooldowns. Do not bypass any
            limits or restrictions.
          </li>
          <li>
            <b>Information Access:</b> AI players may use information available to their
            account through normal gameplay or permitted use of the official API, and
            publicly available resources, such as the public wiki, public channels, and
            public lore. Accessing or using hidden game data, private information the
            account is not authorized to see, or information obtained by bypassing
            access restrictions is prohibited.
          </li>
          <li>
            <b>Bug Reporting:</b> If an AI player finds a bug, exploit, or unintended
            mechanic, it must report it through an official bug reporting channel and
            must not use or exploit it. Discovering an exploit does not make it an
            intended mechanic or give permission to use it.
          </li>
          <li>
            <b>Rule Gaps:</b> Anything not explicitly covered by these rules is not
            automatically allowed. In ambiguous cases, ask a moderator and wait for
            clarification before acting.
          </li>
          <li>
            <b>Human Control Outside the API:</b> Outside the official API allowance
            above, automated play and scripted presence, including timers or scripts
            that keep an account active or progressing while its owner is away, are
            prohibited even under human supervision. AI may provide advice, but the
            human owner must choose and manually initiate each gameplay action.
            Game-managed timers and queued progress started through permitted play are
            allowed. Session length alone does not establish prohibited automation.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="8" />
        <ul className="list-disc pl-5">
          <li>
            <b>Respect for Staff:</b> Harassment of staff is treated the same as
            harassment of players.
          </li>
          <li>
            <b>Constructive Feedback:</b> Must be respectful and submitted in official
            feedback channels. If unsure what channels are acceptable, reach out to a
            moderation staff member.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="9" />
        <ul className="list-disc pl-5">
          <li>
            Official events and media are announced in-game and on official channels.
            Unofficial events are not TNR’s responsibility.
          </li>
          <li>
            Staff participation in unofficial events is at their discretion and does not
            grant official status.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="10" />
        <RuleHeading number="10.1" />
        <ul className="list-disc pl-5">
          <li>
            Impersonating accounts, staff, or players (including past users) is
            prohibited and may result in permanent bans.
          </li>
        </ul>

        <RuleHeading number="10.2" />
        <ul className="list-disc pl-5">
          <li>
            TNR is an English-only game. Short phrases in other languages are allowed,
            but persistent use is not permitted to ensure moderation efficiency.
          </li>
        </ul>

        <RuleHeading number="10.3" />
        <ul className="list-disc pl-5">
          <li>
            Publicly criticizing moderation decisions or making unfounded assumptions
            about punishments is prohibited. Moderators often have access to additional
            context not available to players.
          </li>
        </ul>

        <RuleHeading number="10.4" />
        <ul className="list-disc pl-5">
          <li>
            Players may buy reputation points through the official store or trade with
            other players on the black market for in-game ryo. Buying or selling
            reputation points between players for real-world currency, or advertising
            such trades, is prohibited and may result in a warning or ban.
          </li>
        </ul>
        <hr className="my-2" />

        <RuleHeading number="11" />
        <p className="my-2">
          TNR is provided on an &quot;as-is&quot; basis. Players use the platform at
          their own risk
        </p>
        <hr className="my-2" />

        <RuleHeading number="12" />
        <p className="my-2">
          TNR reserves the right to modify these rules at any time. Announcements will
          be made in-game and on official platforms.
        </p>
        <hr className="my-2" />

        <RuleHeading number="13" />
        <p className="my-2">
          Discord is used as an official means of communication for TNR and the TNR
          community. Bug and moderation tickets can be submitted there as an official
          channel. However for moderation issues the in-game report feature is
          encouraged to create reliable in-game evidence in addition to a moderation
          ticket if one is submitted. Updates and game changes may be posted in Discord
          in addition to in-game.
        </p>

        <RuleHeading number="13.1" />
        <p className="my-2 pl-3">
          The TNR discord generally follows rules of the TNR website, but may have
          additional rules in place in a separate rule channel. It also follows the
          official Discord ToS. It is important to familiarize yourself with both sets
          of the rules. Strikes on discord are considered separate from strikes in-game,
          except for rare or extreme circumstances. Therefore a person may be banned or
          removed from the discord but be allowed to remain in-game. Individuals
          considered exceptionally disruptive to the TNR discord community may be
          removed, as discord is considered non essential for gameplay.
        </p>

        <RuleHeading number="13.2" />
        <p className="my-2 pl-3">
          Any discord besides the main TNR server is considered unofficial, regardless
          of whether it is run by a staff member or player, and is not required to
          follow the official TNR rules. These servers are joined at the risk of the
          player and are not the responsibility of TNR. Except when evidence of in-game
          infractions (such as prohibited automation under section 7.4, account sharing,
          exploitation etc.) or extreme, potentially criminal, circumstances (stalking,
          doxxing etc.) official action will not be taken against a player for behaviour
          within those servers. If users are experiencing negativity, harassment or
          disruptions within these servers, they are encouraged to leave them.
        </p>

        <RuleHeading number="13.2.1" />
        <p className="my-2 pl-3">
          Staff may create, moderate, or participate in external discords. While action
          in these discords are not considered official staff actions, staff are still
          expected to remain reasonably professional as a reflection of the community
          they work for.
        </p>
        <hr className="my-2" />
      </div>
    </ContentBox>
  );
}

/**
 * Rule section headings. Each id derives from the rule number alone (rule-4-3), so links
 * shared by moderators keep working when a title is reworded; renumbering a rule changes
 * its link.
 */
const RuleHeading: React.FC<{ number: string }> = ({ number }) => {
  const heading = RULE_HEADINGS.find((entry) => entry.number === number);
  if (!heading) return null;
  const id = ruleAnchorId(number);
  return heading.level === 2 ? (
    <h2 id={id} className="scroll-mt-[80px] pt-2 font-bold text-xl">
      {number}. {heading.title}
    </h2>
  ) : (
    <h3 id={id} className="scroll-mt-[80px] pt-3 pl-3 font-bold text-lg">
      {number} {heading.title}
    </h3>
  );
};

/** Stable anchor id of a rule, e.g. "4.3" becomes "rule-4-3". */
const ruleAnchorId = (number: string) => `rule-${number.replaceAll(".", "-")}`;

const RULE_HEADINGS: { number: string; title: string; level: 2 | 3 }[] = [
  { number: "1", title: "Code of Conduct", level: 2 },
  { number: "1.1", title: "Respect and Decorum", level: 3 },
  { number: "2", title: "Avatar, Account Name, and Title Guidelines", level: 2 },
  { number: "3", title: "External Links", level: 2 },
  { number: "4", title: "Punishment System", level: 2 },
  { number: "4.1", title: "Overview", level: 3 },
  { number: "4.2", title: "Strike Levels", level: 3 },
  { number: "4.3", title: "Special Punishment Rules", level: 3 },
  { number: "5", title: "Reporting and Appeals", level: 2 },
  { number: "5.1", title: "Reporting Violations", level: 3 },
  { number: "5.2", title: "Appeals Process", level: 3 },
  { number: "6", title: "Staff Roles and Responsibilities", level: 2 },
  { number: "6.1", title: "Roles", level: 3 },
  { number: "6.2", title: "Responsibilities", level: 3 },
  { number: "6.3", title: "Recusal and Conflicts of Interest", level: 3 },
  { number: "6.4", title: "Staff Harassment Protocol", level: 3 },
  { number: "6.5", title: "Staff Probation and Removal", level: 3 },
  { number: "7", title: "Fair Play Guidelines", level: 2 },
  { number: "7.1", title: "Cheating and Exploits", level: 3 },
  { number: "7.2", title: "Account Sharing and Multiple Accounts", level: 3 },
  { number: "7.3", title: "Selling or Transferring Accounts", level: 3 },
  { number: "7.4", title: "AI Players", level: 3 },
  { number: "8", title: "General Community Standards", level: 2 },
  { number: "9", title: "Official Events", level: 2 },
  { number: "10", title: "Additional Guidelines", level: 2 },
  { number: "10.1", title: "Impersonation", level: 3 },
  { number: "10.2", title: "Language Policy", level: 3 },
  { number: "10.3", title: "Criticism of Moderator Decisions", level: 3 },
  { number: "10.4", title: "Selling Reputation Points", level: 3 },
  { number: "11", title: "Disclaimer of Warranties", level: 2 },
  { number: "12", title: "Modification of Terms", level: 2 },
  { number: "13", title: "Discord", level: 2 },
  { number: "13.1", title: "Rules", level: 3 },
  { number: "13.2", title: "External Discords", level: 3 },
  { number: "13.2.1", title: "Staff", level: 3 },
];

/** The "On this page" list links the top-level sections. */
const RULE_TOC = RULE_HEADINGS.filter((heading) => heading.level === 2).map(
  (heading) => ({
    id: ruleAnchorId(heading.number),
    text: `${heading.number}. ${heading.title}`,
    level: 2 as const,
  }),
);
