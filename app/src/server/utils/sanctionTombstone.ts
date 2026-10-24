import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { clerkClient } from "@clerk/nextjs/server";
import {
  and,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  type BanState,
  type SanctionTombstoneType,
  TERR_BOT_ID,
} from "@/drizzle/constants";
import {
  accountDeletion,
  actionLog,
  discordLink,
  historicalIp,
  type SanctionTombstone,
  sanctionTombstone,
  storeUserIdAlias,
  type UserReport,
  userData,
  userReport,
  userReportComment,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { getIpHashSecret } from "@/server/utils/ipHash";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { DELETED_STORE_USER_PREFIX } from "@/server/utils/purchases/grant";

/**
 * Sanction tombstones let a banned or silenced player delete their account (GDPR Art. 17,
 * App Store and Google Play account-deletion rules) without escaping the sanction by
 * registering again.
 *
 * Deleting an account while a ban or silence still runs stores one row per active report:
 * the Clerk user id, keyed hashes of the primary email, linked OAuth accounts (including a
 * linked Discord account) and recorded IP addresses, the end date and the report id that imposed it. No plain addresses or
 * character content are kept, and the hourly cleaner removes the row once the sanction ends.
 *
 * The web character deletion keeps the Clerk user, so the same Clerk id returns on the next
 * registration. The native account deletion deletes the Clerk user, so a returning player
 * gets a new Clerk id and only the email, OAuth and IP hashes can match. A new character that
 * matches serves the remainder: it gets a new report with the same type and end date, so
 * the ordinary ban and silence screens, expiry and staff tools apply to it unchanged.
 */

/** The fields this module reads from a Clerk user. */
export type SanctionIdentity = {
  primaryEmailAddressId: string | null;
  emailAddresses: {
    id: string;
    emailAddress: string;
    verification: { status: string } | null;
  }[];
  externalAccounts: { provider: string; providerUserId: string }[];
};

type ActiveSanction = {
  sanction: SanctionTombstoneType;
  endsAt: Date;
  reportIds: string[];
};

/** One inherited sanction type, its matching identifiers and every retained source. */
export type SanctionMatch = ActiveSanction & {
  matchedBy: ("clerkId" | "email" | "oauth" | "ip")[];
  tombstones: SanctionTombstone[];
};

const REAPPLIED_STATE: Record<SanctionTombstoneType, BanState> = {
  BAN: "BAN_ACTIVATED",
  SILENCE: "SILENCE_ACTIVATED",
};

/**
 * Fold Gmail's documented aliases. Other providers can treat plus signs and dots as
 * distinct mailboxes, so preserve their local parts to avoid sanctioning another owner.
 */
export const normalizeEmail = (email: string) => {
  const [rawLocal = "", rawDomain = ""] = email.trim().toLowerCase().split("@");
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  const local =
    domain === "gmail.com"
      ? (rawLocal.split("+")[0] ?? "").replaceAll(".", "")
      : rawLocal;
  return `${local}@${domain}`;
};

/** Clerk names providers both `oauth_google` and `google`; treat them as one. */
const normalizeProvider = (provider: string) =>
  provider
    .trim()
    .toLowerCase()
    .replace(/^oauth_/, "");

/**
 * HMAC-SHA256 keyed with the app-wide hashing secret, labelled per identifier kind so a
 * value never hashes alike across kinds or across features that share the key.
 */
export const hashSanctionIdentifier = (kind: "email" | "oauth" | "ip", value: string) =>
  createHmac("sha256", getIpHashSecret())
    .update(`sanction-tombstone:${kind}:${value}`)
    .digest("hex");

/**
 * Hash a valid address in the sanction namespace, folding IPv6 and mapped IPv4 aliases.
 * Missing, invalid and zone-scoped addresses return null so placeholders cannot match.
 */
export const hashSanctionIp = (ip: string | null | undefined): string | null => {
  const address = ip?.trim();
  if (!address || !isIP(address) || address.includes("%")) return null;
  let normalized = address;
  if (isIP(address) === 6) {
    normalized = new URL(`http://[${address}]`).hostname.slice(1, -1);
    // Dual-stack proxies may represent the same IPv4 client as an IPv6 mapped address.
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(normalized);
    if (mapped?.[1] && mapped[2]) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      normalized = [high >> 8, high & 255, low >> 8, low & 255].join(".");
    }
  }
  return hashSanctionIdentifier("ip", normalized);
};

/** Hash stable linked provider identifiers and deduplicate equivalent provider names. */
const accountHashesOf = (identity: SanctionIdentity) => [
  ...new Set(
    identity.externalAccounts
      .filter((account) => account.providerUserId)
      .map((account) =>
        hashSanctionIdentifier(
          "oauth",
          `${normalizeProvider(account.provider)}:${account.providerUserId}`,
        ),
      ),
  ),
];

/** Capture only a verified primary email; verified secondary emails count when matching. */
const primaryEmailHashOf = (identity: SanctionIdentity) => {
  const primary = identity.emailAddresses.find(
    (email) => email.id === identity.primaryEmailAddressId,
  );
  return primary?.verification?.status === "verified"
    ? hashSanctionIdentifier("email", normalizeEmail(primary.emailAddress))
    : null;
};

/** Match every verified address with the same normalization used at capture. */
const emailHashesOf = (identity: SanctionIdentity | null) => [
  ...new Set(
    (identity?.emailAddresses ?? [])
      .filter((email) => email.verification?.status === "verified")
      .map((email) =>
        hashSanctionIdentifier("email", normalizeEmail(email.emailAddress)),
      ),
  ),
];

/** Load the Clerk user, or null when Clerk has already deleted it. */
export const fetchSanctionIdentity = async (
  userId: string,
): Promise<SanctionIdentity | null> => {
  try {
    return await (await clerkClient()).users.getUser(userId);
  } catch (error) {
    if (isClerkNotFound(error)) return null;
    throw error;
  }
};

/** A Clerk 404 means identity deletion is complete and cleanup can safely continue. */
export const isClerkNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

/** Current bans and silences, including timeouts, at both preflight and persistence. */
const activeSanctionReportsWhere = (userId: string) =>
  and(
    eq(userReport.reportedUserId, userId),
    inArray(userReport.status, [
      "BAN_ACTIVATED",
      "SILENCE_ACTIVATED",
      "TIMEOUT_ACTIVATED",
    ]),
    gt(userReport.banEnd, new Date()),
  );

/**
 * Store a tombstone for every sanction still running on this account. Call it before the
 * account's reports or its Clerk user are removed.
 *
 * Pass the Clerk user when the caller already holds it; otherwise it is loaded, and only
 * when a sanction exists. The write selects current decisions after the Clerk lookup.
 * Repeated captures preserve captured decisions and case links. Moderation changes the
 * sources through updateSanctionReport; their original reports may now be stale. Live
 * sources can acquire IP hashes even after the original reports are removed.
 */
export const recordSanctionTombstone = async (
  client: DrizzleClient,
  userId: string,
  identity?: SanctionIdentity | null,
) => {
  const [activeReport, user, linkedDiscord] = await Promise.all([
    client.query.userReport.findFirst({
      columns: { id: true },
      where: activeSanctionReportsWhere(userId),
    }),
    client.query.userData.findFirst({
      columns: { lastIp: true },
      where: eq(userData.userId, userId),
    }),
    client.query.discordLink.findFirst({
      columns: { discordId: true },
      where: eq(discordLink.userId, userId),
    }),
  ]);
  const clerkUser = activeReport
    ? identity === undefined
      ? await fetchSanctionIdentity(userId)
      : identity
    : null;
  if (clerkUser) {
    // A Discord account linked to the character counts like a Discord login, so it cannot
    // be linked to the next character while the sanction runs.
    const hashes = {
      emailHash: primaryEmailHashOf(clerkUser),
      accountHashes: accountHashesOf({
        ...clerkUser,
        externalAccounts: [
          ...clerkUser.externalAccounts,
          ...(linkedDiscord
            ? [{ provider: "discord", providerUserId: linkedDiscord.discordId }]
            : []),
        ],
      }),
    };
    const sanction = sql<SanctionTombstoneType>`CASE WHEN ${userReport.status} = 'BAN_ACTIVATED' THEN 'BAN' ELSE 'SILENCE' END`;
    // Select eligibility and the decision in the same write, so a completed staff revision
    // cannot be replaced by a snapshot from before the Clerk lookup.
    await retryOnDeadlock(() =>
      client
        .insert(sanctionTombstone)
        .select(
          client
            .select({
              userId: sql`${userId}`.as("userId"),
              sourceId: userReport.id,
              sanction: sanction.as("sanction"),
              sanctionEndsAt: userReport.banEnd,
              emailHash: sql`${hashes.emailHash}`.as("emailHash"),
              // INSERT SELECT bypasses column encoders; produce SQL JSON for arrays.
              accountHashes:
                sql`CAST(${JSON.stringify(hashes.accountHashes)} AS JSON)`.as(
                  "accountHashes",
                ),
              ipHashes: sql`JSON_ARRAY()`.as("ipHashes"),
              carryoverReportIds: sql`JSON_ARRAY()`.as("carryoverReportIds"),
              createdAt: sql`CURRENT_TIMESTAMP(3)`.as("createdAt"),
            })
            .from(userReport)
            .where(activeSanctionReportsWhere(userId)),
        )
        .onDuplicateKeyUpdate({
          set: {
            emailHash: hashes.emailHash,
            accountHashes: hashes.accountHashes,
          },
        }),
    );
  }
  // Keep the preflight lastIp, and read history only after creating sources. Profile
  // writes append after persisting history: either this read sees the new address,
  // or the profile append sees the retained source.
  const ips = await client.query.historicalIp.findMany({
    columns: { ip: true },
    where: eq(historicalIp.userId, userId),
  });
  await retainSanctionIps(client, userId, [user?.lastIp, ...ips.map(({ ip }) => ip)]);
};

/**
 * Atomically add observed IP hashes to existing unexpired sources without duplicates.
 * Never insert a source or change its decision, so late writes cannot revive a cleared
 * sanction. Persist history first; capture reads it after creating the retained sources.
 */
export const retainSanctionIps = async (
  client: DrizzleClient,
  userId: string,
  ips: (string | null | undefined)[],
) => {
  const hashes = [
    ...new Set(ips.map(hashSanctionIp).filter((hash) => hash !== null)),
  ].sort();
  if (!hashes.length) return;
  // Merge against the current SQL row so concurrent capture/profile appends keep both IPs.
  await retryOnDeadlock(() =>
    client
      .update(sanctionTombstone)
      .set({
        ipHashes: sql`JSON_MERGE_PRESERVE(${sanctionTombstone.ipHashes}, ${sql.join(
          hashes.map(
            (hash) =>
              sql`IF(JSON_CONTAINS(${sanctionTombstone.ipHashes}, JSON_QUOTE(${hash})), JSON_ARRAY(), JSON_ARRAY(${hash}))`,
          ),
          sql`, `,
        )})`,
      })
      .where(
        and(
          eq(sanctionTombstone.userId, userId),
          gt(sanctionTombstone.sanctionEndsAt, sql`CURRENT_TIMESTAMP(3)`),
        ),
      ),
  );
};

/** Unexpired tombstones; registration matches them in memory. */
export const fetchActiveSanctionTombstones = (client: DrizzleClient) =>
  client.query.sanctionTombstone.findMany({
    where: gt(sanctionTombstone.sanctionEndsAt, new Date()),
  });

/**
 * The sanctions a registering account inherits, one per type with the latest end date.
 * Every verified email counts, so moving the old address off primary does not escape it.
 * IP matching uses the exact normalized address, including accounts sharing a public IP.
 */
export const matchSanctionTombstones = (
  tombstones: SanctionTombstone[],
  userId: string,
  identity: SanctionIdentity | null,
  userIp?: string,
): SanctionMatch[] => {
  const emailHashes = new Set(emailHashesOf(identity));
  const accountHashes = new Set(identity ? accountHashesOf(identity) : []);
  const ipHash = hashSanctionIp(userIp);
  const matches = new Map<SanctionTombstoneType, SanctionMatch>();
  for (const tombstone of tombstones) {
    if (tombstone.sanctionEndsAt <= new Date()) continue;
    const matchedBy: SanctionMatch["matchedBy"] = [
      ...(tombstone.userId === userId ? (["clerkId"] as const) : []),
      ...(tombstone.emailHash && emailHashes.has(tombstone.emailHash)
        ? (["email"] as const)
        : []),
      ...(tombstone.accountHashes.some((hash) => accountHashes.has(hash))
        ? (["oauth"] as const)
        : []),
      ...(ipHash && tombstone.ipHashes.includes(ipHash) ? (["ip"] as const) : []),
    ];
    if (matchedBy.length === 0) continue;
    const current = matches.get(tombstone.sanction);
    matches.set(tombstone.sanction, {
      sanction: tombstone.sanction,
      endsAt:
        current && current.endsAt > tombstone.sanctionEndsAt
          ? current.endsAt
          : tombstone.sanctionEndsAt,
      reportIds: [...new Set([...(current?.reportIds ?? []), tombstone.sourceId])],
      matchedBy: [...new Set([...(current?.matchedBy ?? []), ...matchedBy])],
      tombstones: [...(current?.tombstones ?? []), tombstone],
    });
  }
  // Directly matched current reports set the deadline; ancestors preserve case links for
  // later staff decisions, even when the identity no longer matches their hashes.
  for (const match of matches.values()) {
    const reportIds = new Set(match.reportIds);
    for (const source of match.tombstones) {
      for (const ancestor of tombstones) {
        if (
          ancestor.sanction !== match.sanction ||
          ancestor.sanctionEndsAt <= new Date() ||
          match.tombstones.includes(ancestor) ||
          !ancestor.carryoverReportIds.includes(source.sourceId)
        )
          continue;
        match.tombstones.push(ancestor);
        reportIds.add(ancestor.sourceId);
      }
    }
    match.reportIds = [...reportIds];
  }
  return [...matches.values()];
};

/** Stable across retries of the same decisions; a deleted child case changes the key. */
export const carryoverReportId = (userId: string, match: SanctionMatch) =>
  `carryover-${createHash("sha256")
    .update(
      JSON.stringify([
        userId,
        match.sanction,
        match.endsAt,
        match.tombstones
          .map(
            ({
              userId,
              sourceId,
              sanction,
              sanctionEndsAt,
              emailHash,
              accountHashes,
              ipHashes,
            }) => [
              userId,
              sourceId,
              sanction,
              sanctionEndsAt,
              emailHash,
              [...accountHashes].sort(),
              [...ipHashes].sort(),
            ],
          )
          .map((source) => JSON.stringify(source))
          .sort(),
      ]),
    )
    .digest("hex")}`;

/** Staged carryovers may change only while their character is absent. */
const accountAbsent = (userId: string) => sql`NOT EXISTS (
  SELECT 1 FROM ${userData} WHERE ${userData.userId} = ${userId}
)`;

/** Match authority excludes appended links, which other registrations may add. */
const unchangedSource = (source: SanctionTombstone) =>
  and(
    eq(sanctionTombstone.userId, source.userId),
    eq(sanctionTombstone.sourceId, source.sourceId),
    eq(sanctionTombstone.sanction, source.sanction),
    eq(sanctionTombstone.sanctionEndsAt, source.sanctionEndsAt),
    gt(sanctionTombstone.sanctionEndsAt, sql`CURRENT_TIMESTAMP(3)`),
    source.emailHash
      ? eq(sanctionTombstone.emailHash, source.emailHash)
      : isNull(sanctionTombstone.emailHash),
    sql`${sanctionTombstone.accountHashes} = CAST(${JSON.stringify(source.accountHashes)} AS JSON)`,
    sql`${sanctionTombstone.ipHashes} = CAST(${JSON.stringify(source.ipHashes)} AS JSON)`,
  );

/** Remove only unpublished records; a concurrent successful registration keeps its cases. */
export const discardUnpublishedSanctions = async (
  client: DrizzleClient,
  userId: string,
  reportIds: string[],
) => {
  if (!reportIds.length) return;
  for (const reportId of reportIds) {
    await retryOnDeadlock(() =>
      client
        .update(sanctionTombstone)
        .set({
          carryoverReportIds: sql`JSON_REMOVE(${sanctionTombstone.carryoverReportIds}, JSON_UNQUOTE(JSON_SEARCH(${sanctionTombstone.carryoverReportIds}, 'one', ${reportId})))`,
        })
        .where(
          and(
            accountAbsent(userId),
            sql`JSON_CONTAINS(${sanctionTombstone.carryoverReportIds}, JSON_QUOTE(${reportId}))`,
          ),
        ),
    );
  }
  // One delete keeps each case and its supporting records together during retries.
  await retryOnDeadlock(() =>
    client.execute(sql`
    DELETE ${userReport}, ${userReportComment}, ${actionLog} FROM ${userReport}
    LEFT JOIN ${userReportComment} ON ${eq(userReportComment.reportId, userReport.id)}
    LEFT JOIN ${actionLog} ON ${and(eq(actionLog.relatedId, userReport.id), eq(actionLog.tableName, "userReport"), eq(actionLog.userId, userId))}
    WHERE ${and(eq(userReport.reportedUserId, userId), eq(userReport.system, "sanction_carryover"), inArray(userReport.id, reportIds), accountAbsent(userId))}
  `),
  );
};

/**
 * Prepare idempotent moderation records and return the character-publication guard.
 * The guard rechecks current identifiers, including IPs, so stale matches require a retry.
 */
export const reapplySanctions = async (
  client: DrizzleClient,
  userId: string,
  matches: SanctionMatch[],
  previousReportIds: string[],
  identity: SanctionIdentity | null | undefined,
  userIp?: string,
) => {
  const reportIds = matches.map((match) => carryoverReportId(userId, match));
  await discardUnpublishedSanctions(
    client,
    userId,
    previousReportIds.filter((id) => !reportIds.includes(id)),
  );
  const sourcesUnchanged =
    and(
      ...matches.flatMap((match) =>
        match.tombstones.map(
          (source) => sql`EXISTS (
    SELECT 1 FROM ${sanctionTombstone} WHERE ${unchangedSource(source)}
  )`,
        ),
      ),
    ) ?? sql`TRUE`;
  // Drizzle INSERT SELECT requires every table column, including defaults. These small
  // records need subset columns and an account-absence guard, so use parameterized SQL.
  const insertRecord = (
    table: typeof userReport | typeof userReportComment | typeof actionLog,
    values: Record<string, unknown>,
    guard: ReturnType<typeof and>,
  ) => {
    const columns = getTableColumns(table);
    const keys = Object.keys(values) as (keyof typeof columns)[];
    return retryOnDeadlock(() =>
      client.execute(sql`
      INSERT INTO ${table} (${sql.join(
        keys.map((key) => sql.identifier(columns[key].name)),
        sql`, `,
      )})
      SELECT ${sql.join(
        keys.map((key) => sql.param(values[key], columns[key])),
        sql`, `,
      )}
      WHERE ${guard}
      ON DUPLICATE KEY UPDATE id = id
    `),
    );
  };
  try {
    for (const match of matches) {
      const reportId = carryoverReportId(userId, match);
      const status = REAPPLIED_STATE[match.sanction];
      const writable = and(accountAbsent(userId), sourcesUnchanged);
      await insertRecord(
        userReport,
        {
          id: reportId,
          reporterUserId: TERR_BOT_ID,
          reportedUserId: userId,
          system: "sanction_carryover",
          infraction: {},
          reason:
            "This account is subject to a sanction that was still active on a previously deleted account.",
          aiInterpretation: "",
          status,
          adminResolved: true,
          banEnd: match.endsAt,
        } satisfies typeof userReport.$inferInsert,
        writable,
      );
      const reportExists = sql`EXISTS (SELECT 1 FROM ${userReport} WHERE ${and(eq(userReport.id, reportId), eq(userReport.reportedUserId, userId), eq(userReport.status, status), eq(userReport.banEnd, match.endsAt))})`;
      const records = await Promise.allSettled([
        insertRecord(
          userReportComment,
          {
            id: `${reportId}-comment`,
            userId: TERR_BOT_ID,
            reportId,
            content:
              "The remaining sanction from a previously deleted account was re-applied.",
            decision: status,
          } satisfies typeof userReportComment.$inferInsert,
          and(writable, reportExists),
        ),
        insertRecord(
          actionLog,
          {
            id: `${reportId}-log`,
            userId,
            tableName: "userReport",
            relatedId: reportId,
            relatedMsg: `Re-applied ${match.sanction.toLowerCase()} from a deleted account`,
            changes: [
              `Sanction: ${match.sanction} until ${match.endsAt.toISOString()}`,
              `Original reports: ${match.reportIds.join(", ")}`,
              `Matched by: ${match.matchedBy.join(", ")}`,
            ],
          } satisfies typeof actionLog.$inferInsert,
          and(writable, reportExists),
        ),
      ]);
      for (const result of records) {
        if (result.status === "rejected") throw result.reason;
      }
      await retryOnDeadlock(() =>
        client
          .update(sanctionTombstone)
          .set({
            carryoverReportIds: sql`JSON_ARRAY_APPEND(${sanctionTombstone.carryoverReportIds}, '$', ${reportId})`,
          })
          .where(
            and(
              accountAbsent(userId),
              reportExists,
              or(...match.tombstones.map(unchangedSource)),
              sql`NOT JSON_CONTAINS(${sanctionTombstone.carryoverReportIds}, JSON_QUOTE(${reportId}))`,
            ),
          ),
      );
    }
  } catch (error) {
    await discardUnpublishedSanctions(client, userId, reportIds);
    throw error;
  }
  // Publish only after records and links are durable. Abandoned competing attempts
  // cannot become active reports on a later character created with different decisions.
  // If an empty snapshot skipped Clerk, any newly active source requires a fresh attempt.
  const emailHashes = emailHashesOf(identity ?? null);
  const accountHashes = identity ? accountHashesOf(identity) : [];
  const ipHash = hashSanctionIp(userIp);
  const expectedSources = or(
    ...matches.flatMap((match) =>
      match.tombstones.map((source) =>
        and(
          eq(sanctionTombstone.userId, source.userId),
          eq(sanctionTombstone.sourceId, source.sourceId),
        ),
      ),
    ),
  );
  return and(
    accountAbsent(userId),
    sql`NOT EXISTS (SELECT 1 FROM ${sanctionTombstone} WHERE ${and(
      gt(sanctionTombstone.sanctionEndsAt, sql`CURRENT_TIMESTAMP(3)`),
      identity === undefined
        ? undefined
        : or(
            eq(sanctionTombstone.userId, userId),
            emailHashes.length
              ? inArray(sanctionTombstone.emailHash, emailHashes)
              : undefined,
            ...accountHashes.map(
              (hash) =>
                sql`JSON_CONTAINS(${sanctionTombstone.accountHashes}, JSON_QUOTE(${hash}))`,
            ),
            ipHash
              ? sql`JSON_CONTAINS(${sanctionTombstone.ipHashes}, JSON_QUOTE(${ipHash}))`
              : undefined,
          ),
      expectedSources ? not(expectedSources) : undefined,
    )})`,
    sql`NOT EXISTS (SELECT 1 FROM ${userReport} WHERE ${and(
      eq(userReport.reportedUserId, userId),
      eq(userReport.system, "sanction_carryover"),
      reportIds.length
        ? sql`${userReport.id} NOT IN (${sql.join(
            reportIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : undefined,
    )})`,
    ...matches.map((match) => {
      const reportId = carryoverReportId(userId, match);
      return and(
        sql`EXISTS (SELECT 1 FROM ${userReport} WHERE ${and(eq(userReport.id, reportId), eq(userReport.reportedUserId, userId), eq(userReport.status, REAPPLIED_STATE[match.sanction]), eq(userReport.banEnd, match.endsAt))})`,
        sql`EXISTS (SELECT 1 FROM ${userReportComment} WHERE ${eq(userReportComment.id, `${reportId}-comment`)})`,
        sql`EXISTS (SELECT 1 FROM ${actionLog} WHERE ${eq(actionLog.id, `${reportId}-log`)})`,
        ...match.tombstones.map(
          (source) =>
            sql`EXISTS (SELECT 1 FROM ${sanctionTombstone} WHERE ${and(unchangedSource(source), sql`JSON_CONTAINS(${sanctionTombstone.carryoverReportIds}, JSON_QUOTE(${reportId}))`)})`,
        ),
      );
    }),
  );
};

/**
 * Commit a report decision and its retained sources atomically; omitted banEnd is preserved.
 * Cleared cases stay closed after their retained identifiers are pruned.
 * Active decisions during deletion require the account's own captured source.
 * Return false when the report or account is unavailable so callers skip flags and comments.
 */
export const updateSanctionReport = async (
  client: DrizzleClient,
  report: Pick<UserReport, "id" | "reportedUserId">,
  decision: Pick<UserReport, "status" | "adminResolved"> & { banEnd?: Date | null },
) => {
  const sanction = decision.status === "BAN_ACTIVATED" ? "BAN" : "SILENCE";
  const activeEnd = [
    "BAN_ACTIVATED",
    "SILENCE_ACTIVATED",
    "TIMEOUT_ACTIVATED",
  ].includes(decision.status)
    ? decision.banEnd
    : null;
  const endsAt = activeEnd ?? new Date();
  const capturedSource = alias(sanctionTombstone, "capturedSource");
  const sources = or(
    report.reportedUserId
      ? and(
          eq(sanctionTombstone.userId, report.reportedUserId),
          eq(sanctionTombstone.sourceId, report.id),
        )
      : undefined,
    sql`JSON_CONTAINS(${sanctionTombstone.carryoverReportIds}, JSON_QUOTE(${report.id}))`,
  );
  // Drizzle cannot express a multi-table write. A separate source hook can overwrite a
  // newer decision, or lose it when native cleanup removes the report before the hook.
  // LEFT JOIN revises only existing sources; ordinary moderation retains no identifiers.
  // QUEUED can already mean Clerk is gone while its response is pending. Linked ancestors
  // may hold different identity hashes, so only this account's exact source can retain it.
  // Web deletion uses the exact store marker; rename aliases do not retire the account.
  const result = await retryOnDeadlock(() =>
    client.execute(sql`
    UPDATE ${userReport}
    LEFT JOIN ${sanctionTombstone} ON ${sources}
    LEFT JOIN ${accountDeletion} ON ${and(eq(accountDeletion.userId, userReport.reportedUserId), ne(accountDeletion.phase, "COMPLETE"))}
    LEFT JOIN ${storeUserIdAlias} ON ${and(eq(storeUserIdAlias.oldUserId, userReport.reportedUserId), sql`LEFT(${storeUserIdAlias.newUserId}, ${DELETED_STORE_USER_PREFIX.length}) = BINARY ${DELETED_STORE_USER_PREFIX}`)}
    LEFT JOIN ${sanctionTombstone} capturedSource ON ${and(eq(capturedSource.userId, userReport.reportedUserId), eq(capturedSource.sourceId, userReport.id))}
    SET ${userReport.status} = ${decision.status},
        ${userReport.adminResolved} = ${decision.adminResolved},
        ${userReport.updatedAt} = CURRENT_TIMESTAMP(3),
        ${decision.banEnd !== undefined ? sql`${userReport.banEnd} = ${sql.param(decision.banEnd, userReport.banEnd)},` : sql``}
        ${sanctionTombstone.sanction} = ${activeEnd ? sql`${sanction}` : sanctionTombstone.sanction},
        ${sanctionTombstone.sanctionEndsAt} = ${sql.param(endsAt, sanctionTombstone.sanctionEndsAt)}
    WHERE ${and(eq(userReport.id, report.id), ne(userReport.status, "REPORT_CLEARED"), activeEnd ? or(and(isNull(accountDeletion.userId), isNull(storeUserIdAlias.oldUserId)), isNotNull(capturedSource.sourceId)) : undefined)}
  `),
  );
  if (result.rowsAffected === 0) return false;
  // Expiry retires sources in the decision write. Prune only still-expired rows so a
  // delayed clear cannot erase a newer active decision on the same case.
  if (!activeEnd) await removeExpiredSanctionTombstones(client, sources);
  return true;
};

/**
 * Close surviving source reports before pruning their expired retained decisions.
 * An optional source predicate scopes moderation cleanup; the cleaner prunes all expired
 * sources. Ordered guarded writes allow retries after partial failure without a transaction.
 */
export const removeExpiredSanctionTombstones = async (
  client: DrizzleClient,
  sources?: ReturnType<typeof or>,
) => {
  const expired = and(sources, lte(sanctionTombstone.sanctionEndsAt, new Date()));
  // A retry must not recreate a cleared/expired source from its stale original report.
  // Capture never changes existing decisions, so the source remains expired until this
  // durable report closure completes; pruning is safe only after it succeeds.
  await retryOnDeadlock(() =>
    client.execute(sql`
      UPDATE ${userReport}
      INNER JOIN ${sanctionTombstone} ON ${and(eq(userReport.id, sanctionTombstone.sourceId), eq(userReport.reportedUserId, sanctionTombstone.userId))}
      SET ${userReport.status} = 'REPORT_CLEARED', ${userReport.adminResolved} = TRUE, ${userReport.updatedAt} = CURRENT_TIMESTAMP(3)
      WHERE ${and(expired, inArray(userReport.status, ["BAN_ACTIVATED", "SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"]), gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`))}
    `),
  );
  return retryOnDeadlock(() => client.delete(sanctionTombstone).where(expired));
};
