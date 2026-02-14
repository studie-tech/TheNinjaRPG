import { openai as openaiSdk } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import OpenAI from "openai";
import { z } from "zod";
import type { AutomoderationCategory } from "@/drizzle/constants";
import {
  BanStates,
  OPENAI_MODERATION_MODEL,
  REPORT_CONTEXT_WINDOW,
  TERR_BOT_ID,
} from "@/drizzle/constants";
import type { UserReport } from "@/drizzle/schema";
import {
  conversationComment,
  forumPost,
  userData,
  userReportComment,
} from "@/drizzle/schema";
import { insertAutomatedModeration, insertUserReport } from "@/routers/reports";
import type { DrizzleClient } from "@/server/db";
import type { AdditionalContext } from "@/validators/reports";

// OpenAI client
const openai = new OpenAI();

/**
 * Previous report with score and comment
 */
type PreviousReport = UserReport & { score: number; comment: string };

// Moderator Prompt
const getSystemPrompt = (
  content: string,
  interpretation: string,
  previous: PreviousReport[],
) => `
  You're a moderator for a popular online game. You're responsible for enforcing the game's rules and ensuring a safe and enjoyable experience for all players. Here are the rules you need to enforce:

  ## 1. Code of Conduct
  ### 1.1 Respect and Decorum
  To maintain a welcoming environment, all users are required to treat others with respect and dignity. When encountering negative behavior, users are strongly encouraged to use the blacklist feature in addition to reporting an offense. The following behaviors are strictly prohibited:

  - **Harassment:** Targeted insults, threats, or abuse directed at another player or staff member.
  - **Offensive Language:** Use of racist, sexist, discriminatory, obscene, or otherwise offensive language. Moderate use of profanity is allowed; however, excessive or aggressive use directed at others is not. These rules apply equally to all players.
  - **Trolling:** Intentional incitement of negative responses or disruption of community spaces.
  - **Prohibited Topics:** Discussions involving sexual content, political issues, drugs, religion, sensitive issues (e.g., suicide), or ongoing court cases in public forums or the Tavern.
  - **External Harassment:** Personal harassment of TNR community members outside the game, if reported and verified, will be addressed within the rules if deemed exceptional or extreme (e.g., stalking, unwanted sexual advances, blackmail).

  ## 2. Avatar, Account Name, and Title Guidelines

  - **Prohibited Content:** Avatars, account names, and titles depicting political, religiously demeaning, and sexually explicit content, and references to widely illegal drugs, or guns are prohibited. Mildly provocative avatars are allowed.
  - **Disruptive Designs, Names, and Titles:** Avatars designed to annoy, offend, or disrupt the community are prohibited.
  - **Staff Requests:** Moderators may request avatar changes to maintain community standards. Requests must be respected.
  - **Forced Changes:** Names, avatars, or titles deemed inappropriate may be changed without prior notification. Reputation points lost due to these changes will not be refunded unless the action is deemed to be in error by a moderator.

  ## 3. External Links

  - **Prohibited Platforms:** Links to sites associated with drugs, pornography, hate speech, or harmful content are forbidden.
  - **Appropriate Content:** Shared links must align with TNR’s community standards. Misuse will result in disciplinary action.

  ## 4. Punishment System

  ### 4.1 Overview
  Strikes do not reset and remain permanently attached to a user’s record. Moderators typically issue one official warning before applying a strike, unless the violation is severe. A moderator may issue an unofficial warning or rule reminder before issuing a strike or official warning. However, it is considered a courtesy and is not required before official action is taken.

  ### 4.2 Strike Levels

  - **Strike 1:** 24-hour Silence.
  - **Strike 2:** 72-hour Silence.
  - **Strike 3:** 1-week Silence.
  - **Strike 4:** 1-month Silence. Appeals are allowed but rarely granted without substantial proof of error.
  - **Escalation:** Violations beyond 4 strikes may lead to a permanent Silence or Ban.

  ### 4.3 Special Punishment Rules

  - **Minimum Duration:** Silences under 24 hours are not considered strikes.
  - **Bans:** Bans count as 2 strikes. A 3rd ban could lead to a permanent ban.
  - **Immediate Action:** Severe violations (e.g., hate speech, threats, doxxing, sexual harassment) may result in immediate silences or bans, possibly permanent.
  - **Game Abuse:** Abuse of bugs and game mechanics will result in a ban instead of a silence. Game abuse will not be tolerated. Users may not be given a warning if the abuse is believed to be intentional.
  - **Strike Removal:** Strikes for completed punishments may be removed, under review, after a year of good behavior. However, removal is not guaranteed.

  ## 5. Reporting and Appeals

  ### 5.1 Reporting Violations
  Users should report rule violations via the in-game reporting system. Reports must include relevant evidence. Abuse of the system may result in penalties for the reporting user.

  - **Evidence Requirements:** Screenshots and grabs may be submitted as evidence. However, the use of them is at the discretion of the moderation staff and may be dismissed due to the ability to alter images. Users are encouraged to use the official reporting feature as it is the most reliable evidence.

  ### 5.2 Appeals Process
  Users may appeal disciplinary actions by contacting the issuing Moderator or Head Moderator. Appeals require substantial evidence and are rarely granted for permanent bans.

  ## 6. Staff Roles and Responsibilities

  ### 6.1 Roles

  - **Jr. Moderators:** Moderators in training. May issue warnings and silences.
  - **Moderators:** Address immediate issues and primarily enforce silences. May issue bans.
  - **Head Moderator:** Oversees escalations, appeals, and issues bans and silences.
  - **Moderator Admin:** Manages the moderation team and resolves internal complaints regarding moderation staff.
  - **Content Staff:** Ensures in-game balance and addresses bugs.
  - **Event Staff:** Creates lore, event imagery, and manages events.
  - **Content Admin:** Directs content and event staff to help ensure cohesive gameplay and balancing. Resolves internal complaints regarding content and event staff.
  - **Coder:** Responsible for fixing bugs and creating game features.
  - **Site Owner:** Terriator is owner of TNR and the final appeal of all complaints and PayPal issues.

  ### 6.2 Responsibilities

  - **Transparency:** All disciplinary actions must be logged and justified.

  ## 7. Fair Play Guidelines

  ### 7.1 Cheating and Exploits
  Exploiting mechanics or using unauthorized third-party tools is prohibited. Punishment escalates from temporary bans to permanent bans for repeated offenses.

  ### 7.2 Account Sharing and Multiple Accounts
  Accounts must be used by a single individual. Shared or multiple accounts on the same IP must be reported to moderators to avoid penalties.

  - **Multiple Accounts:** If multiple accounts on a single IP are discovered, the account owner will be asked to mark the additional accounts for deletion. Failure to do so may result in bans on all accounts. Users will be given a 24-hour window to reply to the request before action is taken.

  ### 7.3 Selling or Transferring Accounts
  Strictly prohibited and may result in permanent bans.

  ## 8. General Community Standards

  - **Respect for Staff:** Harassment of staff is treated the same as harassment of players.
  - **Constructive Feedback:** Must be respectful and submitted in official feedback channels. If unsure what channels are acceptable, reach out to a moderation staff member.

  ## 9. Official Events
  Official events and media are announced in-game and on official channels. Unofficial events are not TNR’s responsibility. Staff participation in unofficial events is at their discretion and does not grant official status.

  ## 10. Additional Guidelines

  ### 10.1 Impersonation
  Impersonating accounts, staff, or players (including past users) is prohibited and may result in permanent bans.

  ### 10.2 Language Policy
  TNR is an English-only game. Short phrases in other languages are allowed, but persistent use is not permitted to ensure moderation efficiency.

  ### 10.3 Criticism of Moderator Decisions
  Publicly criticizing moderation decisions or making unfounded assumptions about punishments is prohibited. Moderators often have access to additional context not available to players.

  --- 

  Please review the following situation and determine if it violates the game's rules:

  [MESSAGE]: ${content}
  [CONTEXT]: ${interpretation}

  # Guide
  - In your reasoning, do not include statements like "a report should be created" or "warrents further review".
  - If you do not believe a report should be created, please mark it as "REPORT_CLEARED"

  # Previous Reports with Actions
  The following are the previous reports found in the system and their decisions, 
  which may help you in your decision-making process. For each previous decision a comment
  on the decision is included. Please be aware that some reports may have been cleared because 
  they were handled in another capacity.

  ${previous
    .map((report) => {
      return `
      - [CONTEXT]: ${report.aiInterpretation}
      - [DECISION]: ${report.status}
      - [COMMENT]: ${report.comment}
      `;
    })
    .join("\n\n")}
`;

/**
 * Moderate content
 * @param client - The database client
 * @param info - The information to moderate
 * @returns The moderation decision
 */
export const moderateContent = async (
  client: DrizzleClient,
  info: {
    content: string;
    userId: string;
    relationType: AutomoderationCategory;
    relationId: string;
    contextId?: string;
  },
) => {
  // Destructure
  const { content, userId, relationType, relationId, contextId } = info;
  // Step 1: Ask moderation API if anything is suspecious
  const moderation = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: content,
  });
  const result = moderation.results?.[0];
  if (result?.flagged) {
    // Step 2: Ask AI if we should make a report
    const ctx = await getAdditionalContext(client, relationType, new Date(), contextId);
    const { decision, aiInterpretation } = await generateModerationDecision(
      client,
      content,
      ctx,
    );
    // Step 3: Insert moderation & if relevant the report + update reported status
    return Promise.all([
      insertAutomatedModeration(client, {
        userId: userId,
        content: content,
        relationType: relationType,
        categories: {
          sexual: result.categories.sexual,
          sexual_minors: result.categories["sexual/minors"],
          harassment: result.categories.harassment,
          harassment_threatening: result.categories["harassment/threatening"],
          hate: result.categories.hate,
          hate_threatening: result.categories["hate/threatening"],
          illicit: result.categories.illicit ?? false,
          illicit_violent: result.categories["illicit/violent"] ?? false,
          self_harm: result.categories["self-harm"],
          self_harm_intent: result.categories["self-harm/intent"],
          self_harm_instructions: result.categories["self-harm/instructions"],
          violence: result.categories.violence,
          violence_graphic: result.categories["violence/graphic"],
        },
      }),
      ...(decision.createReport !== "REPORT_CLEARED"
        ? [
            insertUserReport(client, {
              userId: TERR_BOT_ID,
              reportedUserId: userId,
              system: relationType,
              infraction: { content },
              reason: decision.reasoning,
              aiInterpretation: aiInterpretation,
              predictedStatus: decision.createReport,
              additionalContext: ctx,
            }),
            updateReportedStatus(client, relationType, relationId),
          ]
        : []),
    ]);
  }
};

/**
 * Get additional context for a given content
 * @param client - The database client
 * @param system - The system of the content
 * @param timestamp - The timestamp of the content
 * @param conversationId - The ID of the conversation
 * @returns The additional context
 */
export const getAdditionalContext = async (
  client: DrizzleClient,
  system: string,
  timestamp?: Date | null,
  conversationId?: string | null,
) => {
  if (!conversationId) return [];
  switch (system) {
    case "comment":
    case "privateMessage":
    case "conversation_comment":
      return await client
        .select({
          userId: conversationComment.userId,
          username: userData.username,
          avatar: userData.avatar,
          level: userData.level,
          rank: userData.rank,
          federalStatus: userData.federalStatus,
          isOutlaw: userData.isOutlaw,
          role: userData.role,
          content: conversationComment.content,
          createdAt: conversationComment.createdAt,
        })
        .from(conversationComment)
        .innerJoin(userData, eq(conversationComment.userId, userData.userId))
        .where(
          and(
            eq(conversationComment.conversationId, conversationId),
            lt(conversationComment.createdAt, timestamp || new Date()),
          ),
        )
        .orderBy(desc(conversationComment.createdAt))
        .limit(REPORT_CONTEXT_WINDOW);
    case "forumPost":
    case "forum_comment":
      return await client
        .select({
          userId: forumPost.userId,
          username: userData.username,
          avatar: userData.avatar,
          level: userData.level,
          rank: userData.rank,
          federalStatus: userData.federalStatus,
          isOutlaw: userData.isOutlaw,
          role: userData.role,
          content: forumPost.content,
          createdAt: forumPost.createdAt,
        })
        .from(forumPost)
        .innerJoin(userData, eq(forumPost.userId, userData.userId))
        .where(
          and(
            eq(forumPost.threadId, conversationId),
            lt(forumPost.createdAt, timestamp || new Date()),
          ),
        )
        .orderBy(desc(forumPost.createdAt))
        .limit(REPORT_CONTEXT_WINDOW);
    default:
      return [];
  }
};

/**
 * Generate a summary of the content
 * @param content - The content to summarize
 * @returns The summary
 */
export const generateAiSummary = async (
  content: unknown,
  context?: AdditionalContext[],
) => {
  const { text } = await generateText({
    model: openaiSdk(OPENAI_MODERATION_MODEL),
    prompt: `
    Condense this article into a 25-word summary that captures the core message and most important takeaways. Avoid technical jargon and prioritize simplicity

    The summary will be used for future searches on similar posts (given the convo context), so it is important to e.g. highlight whether the post is in the context of conversation of playful banter or a serious accusation / offending.

    <important>
      Do not include any IDs in the summary.
    </important>

    <post>
      ${JSON.stringify(content)}
    </post>

    <context>
      ${context?.map((c) => `${c.username}: ${c.content}`).join("\n")}
    </context>`,
  });
  return text;
};

/**
 * Get related reports from the database
 * @param client - The database client
 * @param aiInterpretation - The AI interpretation of the content
 * @returns The related reports
 */
export const getRelatedReports = async (
  client: DrizzleClient,
  aiInterpretation: string,
) => {
  try {
    const results = await client.execute(sql`
      SELECT 
        UserReport.createdAt,
        UserReport.id,
        UserReport.aiInterpretation, 
        UserReport.reason,
        UserReport.infraction, 
        UserReport.status,
        UserReportComment.content as comment,
        MATCH(UserReport.aiInterpretation) AGAINST(${aiInterpretation}) as score
      FROM UserReport
      INNER JOIN UserReportComment ON UserReport.id = UserReportComment.reportId
      WHERE 
        MATCH(UserReport.aiInterpretation) AGAINST(${aiInterpretation}) AND
        UserReport.aiInterpretation != "" AND
        json_length(UserReport.additionalContext) > 0 AND
        UserReport.system != "user_profile" AND
        UserReport.status != 'UNVIEWED'
      ORDER BY score DESC
      LIMIT 10`);
    return results.rows as PreviousReport[];
  } catch (error) {
    console.error(error);
    return [];
  }
};

/**
 * Generate a moderation decision for a given content
 * @param client - The database client
 * @param content - The content to moderate
 * @param context - The additional context to use for the moderation decision
 * @returns The moderation decision
 */
export const generateModerationDecision = async (
  client: DrizzleClient,
  content: string,
  context?: AdditionalContext[],
): Promise<{
  decision: { createReport: (typeof BanStates)[number]; reasoning: string };
  aiInterpretation: string;
}> => {
  // Step 1: Generate summary of the content
  const aiInterpretation = await generateAiSummary({ content, context });
  // Step 2: Fetch related userReport using full text search
  const prevReports = await getRelatedReports(client, aiInterpretation);
  // Step 3: Create decision with AI based on summary and related reports
  const decisionSchema = z.object({
    createReport: z.enum(BanStates),
    reasoning: z.string(),
  });
  const { object } = await generateObject({
    model: openaiSdk(OPENAI_MODERATION_MODEL),
    schema: decisionSchema,
    prompt: getSystemPrompt(content, aiInterpretation, prevReports),
  });
  return { decision: object as z.infer<typeof decisionSchema>, aiInterpretation };
};

/**
 * Update the reported status of a given content
 * @param client - The database client
 * @param system - The system of the content
 * @param relationId - The ID of the content
 */
const updateReportedStatus = async (
  client: DrizzleClient,
  system: AutomoderationCategory,
  relationId: string,
) => {
  switch (system) {
    case "comment":
      await client
        .update(conversationComment)
        .set({ isReported: true })
        .where(eq(conversationComment.id, relationId));
      break;
    case "forumPost":
      await client
        .update(forumPost)
        .set({ isReported: true })
        .where(eq(forumPost.id, relationId));
      break;
    case "userReport":
      await client
        .update(userReportComment)
        .set({ isReported: true })
        .where(eq(userReportComment.id, relationId));
      break;
  }
};

/**
 * Validate a user update reason
 * @param update - The update to validate
 * @param reason - The reason for the update
 * @returns The validation result
 */
export const validateUserUpdateReason = async (
  update: string,
  reason: string,
): Promise<{ allowUpdate: boolean; comment: string }> => {
  const validationSchema = z.object({ allowUpdate: z.boolean(), comment: z.string() });
  const { object } = await generateObject({
    model: openaiSdk(OPENAI_MODERATION_MODEL),
    schema: validationSchema,
    prompt: `
      The following reason/explanation is supplied by a content member to update a piece of game content
      Please determine if the reason is descriptive and if the update should be allowed.
      Content members are tasked with testing things, helping users, etc, and thus the reasons serves mostly as a way to provide transparency to the end users as for why a given update was made.
      You are not to judge the validity of the update, only verify that it explains the update in a way that reason is clear.

      - The main purpose of the reason is to give a bit of context, and not just be a empty string or randomly filled letters.
      - The reason must not be offensive.
      - Ignore spelling errors, this is not important to the moderation process.
      - If the reason is not valid, please provide a comment explaining why the update should not be allowed.
      - The reason does not have to include details about the update, the previous state, or new state

      <reason>
        ${reason}
      </reason>

      <update>
        ${update}
      </update>
    `,
  });
  return object as z.infer<typeof validationSchema>;
};
