/**
 * Database access for Google Ads click conversions; authentication stays in callers.
 */
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type AdClickConsent,
  type AdClickIdType,
  type AdConversionAction,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
} from "@/drizzle/constants";
import { adClick, adConversionUpload, questHistory, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import {
  AD_CLICK_IP_LINK_DAYS,
  AD_CLICK_RETENTION_DAYS,
} from "@/server/utils/adConversions";
import { hashIp } from "@/server/utils/ipHash";

/**
 * Build the `adClick` insert for `trackVisitor`. A click reported again keeps its row,
 * upgraded to granted when the visitor has since accepted marketing cookies. A click
 * already linked to a character keeps the registrant's own consent.
 */
export const insertAdClickForTrackVisitor = (
  client: Pick<DrizzleClient, "insert">,
  click: {
    clickId: string;
    clickIdType: AdClickIdType;
    ip: string;
    consent: AdClickConsent;
  },
) =>
  client
    .insert(adClick)
    .values({
      id: nanoid(),
      clickId: click.clickId,
      clickIdType: click.clickIdType,
      ipHash: hashIp(click.ip),
      adUserDataConsent: click.consent,
    })
    .onDuplicateKeyUpdate({
      set: {
        adUserDataConsent:
          click.consent === "granted"
            ? sql`IF(${adClick.userId} IS NULL, 'granted', ${adClick.adUserDataConsent})`
            : sql`${adClick.adUserDataConsent}`,
      },
    });

/**
 * Build the `adClick` lookup for `createCharacter` of the click stored on the device,
 * while Google still accepts its conversions.
 */
export const findUnlinkedAdClickByClickId = (
  client: Pick<DrizzleClient, "query">,
  clickId: string,
) =>
  client.query.adClick.findFirst({
    columns: { id: true },
    where: and(
      eq(adClick.clickId, clickId),
      isNull(adClick.userId),
      gte(
        adClick.createdAt,
        sql`CURRENT_TIMESTAMP(3) - INTERVAL ${AD_CLICK_RETENTION_DAYS} DAY`,
      ),
    ),
  });

/**
 * Build the `adClick` lookup for `createCharacter` of the latest unlinked click from the
 * registrant's IP hash within the IP link window, for a device that has no click stored.
 */
export const findLatestUnlinkedAdClickByIp = (
  client: Pick<DrizzleClient, "query">,
  ip: string,
) =>
  client.query.adClick.findFirst({
    columns: { id: true },
    where: and(
      eq(adClick.ipHash, hashIp(ip)),
      isNull(adClick.userId),
      gte(
        adClick.createdAt,
        sql`CURRENT_TIMESTAMP(3) - INTERVAL ${AD_CLICK_IP_LINK_DAYS} DAY`,
      ),
    ),
    orderBy: desc(adClick.createdAt),
  });

/** Build the `adClick` update linking a still-unlinked click to a new character. */
export const linkAdClickToUser = (
  client: Pick<DrizzleClient, "update">,
  link: { id: string; userId: string; consent: AdClickConsent },
) =>
  client
    .update(adClick)
    .set({ userId: link.userId, adUserDataConsent: link.consent })
    .where(and(eq(adClick.id, link.id), isNull(adClick.userId)));

/**
 * Build the `adClick` deletion for `withdrawAdClickConsent` of the visitor's unlinked click.
 * A click linked to a character is left to its owner.
 */
export const deleteUnlinkedAdClickForWithdrawnConsent = (
  client: Pick<DrizzleClient, "delete">,
  clickId: string,
) =>
  client
    .delete(adClick)
    .where(and(eq(adClick.clickId, clickId), isNull(adClick.userId)));

/**
 * Build the `adClick` deletion for `withdrawAdClickConsent` of the clicks linked to a
 * signed-in visitor's character.
 */
export const deleteLinkedAdClicksForWithdrawnConsent = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(adClick).where(eq(adClick.userId, userId));

/** Build the selection of characters created after their linked click and not yet sent. */
export const selectPendingRegisterAdConversions = (
  client: Pick<DrizzleClient, "select">,
  limit: number,
) =>
  client
    .select({
      adClickId: adClick.id,
      clickId: adClick.clickId,
      clickIdType: adClick.clickIdType,
      consent: adClick.adUserDataConsent,
      convertedAt: userData.createdAt,
    })
    .from(adClick)
    .innerJoin(userData, eq(userData.userId, adClick.userId))
    .where(
      and(
        // Implied by the join; lets MySQL read only linked clicks through the userId index.
        isNotNull(adClick.userId),
        isNull(adClick.registerReportedAt),
        notUploaded(client, "register"),
        // A click linked after the conversion did not cause it.
        gte(userData.createdAt, adClick.createdAt),
      ),
    )
    .orderBy(adClick.createdAt)
    .limit(limit);

/** Build the selection of Genin exams completed after their linked click and not yet sent. */
export const selectPendingTutorialAdConversions = (
  client: Pick<DrizzleClient, "select">,
  limit: number,
) =>
  client
    .select({
      adClickId: adClick.id,
      clickId: adClick.clickId,
      clickIdType: adClick.clickIdType,
      consent: adClick.adUserDataConsent,
      // Never null: the endAt filter below excludes rows without one.
      convertedAt: sql<Date>`${questHistory.endAt}`.mapWith(questHistory.endAt),
    })
    .from(adClick)
    .innerJoin(questHistory, eq(questHistory.userId, adClick.userId))
    .where(
      and(
        // Implied by the join; lets MySQL read only linked clicks through the userId index.
        isNotNull(adClick.userId),
        isNull(adClick.tutorialReportedAt),
        notUploaded(client, "tutorialComplete"),
        eq(questHistory.questId, TUTORIAL_GENIN_EXAM_QUEST_ID),
        eq(questHistory.completed, 1),
        gte(questHistory.endAt, adClick.createdAt),
      ),
    )
    .orderBy(adClick.createdAt)
    .limit(limit);

/** Build the `adClick` update recording that Google settled these conversions. */
export const markAdConversionsReported = (
  client: Pick<DrizzleClient, "update">,
  action: AdConversionAction,
  adClickIds: string[],
) => {
  const column = action === "register" ? "registerReportedAt" : "tutorialReportedAt";
  return client
    .update(adClick)
    .set({ [column]: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(inArray(adClick.id, adClickIds), isNull(adClick[column])));
};

/** Build the `adConversionUpload` insert recording the events of one sent request. */
export const insertAdConversionUploads = (
  client: Pick<DrizzleClient, "insert">,
  requestId: string,
  events: { adClickId: string; action: AdConversionAction }[],
) =>
  client.insert(adConversionUpload).values(
    events.map((event, eventIndex) => ({
      id: nanoid(),
      requestId,
      eventIndex,
      adClickId: event.adClickId,
      action: event.action,
    })),
  );

/** Build the selection of uploads still waiting for Google's processing status. */
export const selectAdConversionUploads = (
  client: Pick<DrizzleClient, "select">,
  limit: number,
) =>
  client
    .select()
    .from(adConversionUpload)
    .orderBy(adConversionUpload.createdAt)
    .limit(limit);

/** Build the `adConversionUpload` deletion of settled or resent upload rows. */
export const deleteAdConversionUploads = (
  client: Pick<DrizzleClient, "delete">,
  ids: string[],
) => client.delete(adConversionUpload).where(inArray(adConversionUpload.id, ids));

/** A conversion that is not part of an upload awaiting its status. */
const notUploaded = (
  client: Pick<DrizzleClient, "select">,
  action: AdConversionAction,
) =>
  notExists(
    client
      .select({ id: adConversionUpload.id })
      .from(adConversionUpload)
      .where(
        and(
          eq(adConversionUpload.adClickId, adClick.id),
          eq(adConversionUpload.action, action),
        ),
      ),
  );
