import ContentBox from "@/layout/ContentBox";

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
        <hr className="my-2" />

        <h2 className="font-bold text-lg">1. Code of Conduct</h2>
        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;1.1 Respect and Decorum</h3>
        <p className="my-2">
          &nbsp;&nbsp;To maintain a welcoming environment, all users are required to
          treat others with respect and dignity. When encountering negative behavior
          users are strongly encouraged to use the blacklist feature in addition to
          reporting an offense. The following behaviors are strictly prohibited:
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

        <h2 className="font-bold text-lg">
          2. Avatar, Account Name, and Title Guidelines
        </h2>
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

        <h2 className="font-bold text-lg">3. External Links</h2>
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

        <h2 className="font-bold text-lg">4. Punishment System</h2>
        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;4.1 Overview</h3>
        <p className="my-2">
          &nbsp;&nbsp;Strikes do not reset and remain permanently attached to a user’s
          record. Moderators typically issue one official warning before applying a
          strike, unless the violation is severe. A moderator may issue an unofficial
          warning or rule reminder before issuing a strike or official warning. However,
          it is considered a courtesy and is not required before official action is
          taken.
        </p>

        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;4.2 Strike Levels</h3>
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

        <h3 className="pt-3 font-bold text-md">
          &nbsp;&nbsp;4.3 Special Punishment Rules
        </h3>
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

        <h2 className="font-bold text-lg">5. Reporting and Appeals</h2>
        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;5.1 Reporting Violations</h3>
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

        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;5.2 Appeals Process</h3>
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

        <h2 className="font-bold text-lg">6. Staff Roles and Responsibilities</h2>
        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;6.1 Roles</h3>
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

        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;6.2 Responsibilities</h3>
        <ul className="list-disc pl-5">
          <li>
            <b>Transparency:</b> All disciplinary actions must be logged and justified.
          </li>
        </ul>
        <hr className="my-2" />

        <h2 className="font-bold text-lg">7. Fair Play Guidelines</h2>
        <h3 className="pt-3 font-bold text-md">
          &nbsp;&nbsp;7.1 Cheating and Exploits
        </h3>
        <ul className="list-disc pl-5">
          <li>
            Exploiting mechanics or using unauthorized third-party tools is prohibited.
          </li>
          <li>
            Punishment escalates from temporary bans to permanent bans for repeated
            offenses.
          </li>
        </ul>

        <h3 className="pt-3 font-bold text-md">
          &nbsp;&nbsp;7.2 Account Sharing and Multiple Accounts
        </h3>
        <ul className="list-disc pl-5">
          <li>Players are restricted to two accounts.</li>
          <li>
            Accounts must be used by a single individual. Shared or multiple accounts on
            the same IP must be reported to moderators to avoid penalties.
          </li>
          <li>
            Sharing accounts between players on the same IP is prohibited. If this is
            proven, it may lead to a warning or ban of all shared accounts.
          </li>
          <li>
            If multiple accounts on a single IP are discovered the account owner will be
            asked to mark the additional accounts for deletion. Failure to do so may
            result in bans on all accounts. Users will be given a 24hr window to reply
            to the request before action will be taken.
          </li>
          <li>
            The killing of one’s own secondary account, as well as the coordinated
            farming of another user’s alt, is prohibited. Players caught doing so may
            receive a warning or ban.
          </li>
        </ul>

        <h3 className="pt-3 font-bold text-md">
          &nbsp;&nbsp;7.3 Selling or Transferring Accounts
        </h3>
        <ul className="list-disc pl-5">
          <li>Strictly prohibited and may result in permanent bans.</li>
        </ul>
        <hr className="my-2" />

        <h2 className="font-bold text-lg">8. General Community Standards</h2>
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

        <h2 className="font-bold text-lg">9. Official Events</h2>
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

        <h2 className="font-bold text-lg">10. Additional Guidelines</h2>
        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;10.1 Impersonation</h3>
        <ul className="list-disc pl-5">
          <li>
            Impersonating accounts, staff, or players (including past users) is
            prohibited and may result in permanent bans.
          </li>
        </ul>

        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;10.2 Language Policy</h3>
        <ul className="list-disc pl-5">
          <li>
            TNR is an English-only game. Short phrases in other languages are allowed,
            but persistent use is not permitted to ensure moderation efficiency.
          </li>
        </ul>

        <h3 className="pt-3 font-bold text-md">
          &nbsp;&nbsp;10.3 Criticism of Moderator Decisions
        </h3>
        <ul className="list-disc pl-5">
          <li>
            Publicly criticizing moderation decisions or making unfounded assumptions
            about punishments is prohibited. Moderators often have access to additional
            context not available to players.
          </li>
        </ul>

        <h3 className="pt-3 font-bold text-md">
          &nbsp;&nbsp;10.4 Selling Reputation Points
        </h3>
        <ul className="list-disc pl-5">
          <li>
            The selling and the advertisement of selling reputation points for real
            currency is prohibited. Players wishing to buy reputation points may only
            use the blackmarket to purchase through paypal or with ryo from another
            player. Players caught doing so may face warnings or a ban.
          </li>
        </ul>
        <hr className="my-2" />

        <h2 className="font-bold text-lg">11. Disclaimer of Warranties</h2>
        <p className="my-2">
          TNR is provided on an &quot;as-is&quot; basis. Players use the platform at
          their own risk
        </p>
        <hr className="my-2" />

        <h2 className="font-bold text-lg">12. Modification of Terms</h2>
        <p className="my-2">
          TNR reserves the right to modify these rules at any time. Announcements will
          be made in-game and on official platforms.
        </p>
        <hr className="my-2" />

        <h2 className="font-bold text-lg">13. Discord</h2>
        <p className="my-2">
          Discord is used as an official means of communication for TNR and the TNR
          community. Bug and moderation tickets can be submitted there as an official
          channel. However for moderation issues the in-game report feature is
          encouraged to create reliable in-game evidence in addition to a moderation
          ticket if one is submitted. Updates and game changes may be posted in Discord
          in addition to in-game.
        </p>

        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;13.1 Rules</h3>
        <p className="my-2">
          &nbsp;&nbsp;The TNR discord generally follows rules of the TNR website, but
          may have additional rules in place in a separate rule channel. It also follows
          the official Discord ToS. It is important to familiarize yourself with both
          sets of the rules. Strikes on discord are considered separate from strikes
          in-game, except for rare or extreme circumstances. Therefore a person may be
          banned or removed from the discord but be allowed to remain in-game.
          Individuals considered exceptionally disruptive to the TNR discord community
          may be removed, as discord is considered non essential for gameplay.
        </p>

        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;13.2 External Discords</h3>
        <p className="my-2">
          &nbsp;&nbsp;Any discord besides the main TNR server is considered unofficial,
          regardless of whether it is run by a staff member or player, and is not
          required to follow the official TNR rules. These servers are joined at the
          risk of the player and are not the responsibility of TNR. Except when evidence
          of in-game infractions (such as botting, account sharing, exploitation etc.)
          or extreme, potentially criminal, circumstances (stalking, doxxing etc.)
          official action will not be taken against a player for behaviour within those
          servers. If users are experiencing negativity, harassment or disruptions
          within these servers, they are encouraged to leave them.
        </p>

        <h3 className="pt-3 font-bold text-md">&nbsp;&nbsp;13.2.1 Staff</h3>
        <p className="my-2">
          &nbsp;&nbsp;Staff may create, moderate, or participate in external discords.
          While action in these discords are not considered official staff actions,
          staff are still expected to remain reasonably professional as a reflection of
          the community they work for.
        </p>
        <hr className="my-2" />
      </div>
    </ContentBox>
  );
}
