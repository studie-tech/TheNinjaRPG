/** Run after 0052/0053 and before 0054, with gameplay writes frozen. */
import {and, eq, sql} from "drizzle-orm";
import {CombatStatNames, MasteryNames, getUserCaps} from "@/drizzle/constants";
import {trainingLog, userData, userItem, userSkill} from "@/drizzle/schema";
import {filterQuestTrackersForDbPersist, getNewTrackers} from "@/libs/quest";
import {calcMaxEnergy} from "@/libs/profile";
import {calcTrainingAmount} from "@/routers/train";
import {drizzleDB as db} from "@/server/db";

const pending = await db.execute(sql`SELECT userId, currentlyTraining, DATE_FORMAT(trainingStartedAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS trainingStartedAt, DATE_FORMAT(lastCombatTrainingFinishedAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS lastCombatTrainingFinishedAt FROM UserData WHERE currentlyTraining IS NOT NULL OR currentlyTrainingMastery IS NOT NULL`);
const settings = await db.query.gameSetting.findMany();
for (const raw of pending.rows) {
  const row = raw as Record<string, unknown>;
  const userId = String(row.userId);
  const user = await db.query.userData.findFirst({where: eq(userData.userId, userId),
    columns: {curEnergy: false, maxEnergy: false},
    with: {bloodline: true, clan: true, village: {with: {structures: true, sectors: true}},
      userQuests: {with: {quest: true}}, completedQuests: true, items: {with: {item: true}}}});
  if (!user) throw new Error(`Missing user ${userId}`);
  const source = {...user, curEnergy: 100, maxEnergy: 100};
  const stat = row.currentlyTraining;
  if (stat != null && !(CombatStatNames as readonly unknown[]).includes(stat)) throw new Error(`Unrecognized training stat for ${userId}`);
  const started = row.trainingStartedAt ? new Date(String(row.trainingStartedAt)) : null;
  const mastery = user.currentlyTrainingMastery;
  if (mastery != null && !MasteryNames.includes(mastery)) throw new Error(`Unrecognized mastery for ${userId}`);
  const amount = stat && started ? calcTrainingAmount(source, settings, started).trainingAmount : 0;
  const masteryAmount = mastery && user.masteryTrainingStartedAt
    ? Math.max(0, Math.min(calcTrainingAmount(source, settings, user.masteryTrainingStartedAt).trainingAmount, getUserCaps(user.rank).mastery_cap - user[mastery])) : 0;
  const starts = [started, user.masteryTrainingStartedAt].filter((date): date is Date => date !== null);
  const watermark = row.lastCombatTrainingFinishedAt ? new Date(String(row.lastCombatTrainingFinishedAt)).getTime() : 0;
  const minutes = starts.length ? Math.max(0, (Date.now() - Math.max(Math.min(...starts.map(date => date.getTime())), watermark)) / 60_000) : 0;
  const {trackers} = getNewTrackers(source, [{task: "stats_trained", increment: amount}, {task: "minutes_training", increment: minutes}]);
  // Match both sessions: a rerun sees cleared slots and cannot grant their gains again.
  const result = await db.execute(sql`UPDATE UserData SET
    ${stat ? sql`${userData[stat as (typeof CombatStatNames)[number]]} = ${userData[stat as (typeof CombatStatNames)[number]]} + ${amount},` : sql``}
    ${mastery ? sql`${userData[mastery]} = ${userData[mastery]} + ${masteryAmount},` : sql``}
    experience = experience + ${amount}, dailyTrainings = dailyTrainings + ${Number(amount > 0) + Number(masteryAmount > 0)},
    questData = ${JSON.stringify(filterQuestTrackersForDbPersist(trackers, source))},
    currentlyTraining = NULL, trainingStartedAt = NULL, currentlyTrainingMastery = NULL, masteryTrainingStartedAt = NULL, updatedAt = NOW(3)
    WHERE userId = ${userId} AND currentlyTraining <=> ${stat ?? null} AND trainingStartedAt <=> ${started} AND currentlyTrainingMastery <=> ${mastery} AND masteryTrainingStartedAt <=> ${user.masteryTrainingStartedAt}`);
  if (result.rowsAffected !== 1) throw new Error(`Training changed for ${userId}; keep writes frozen and retry`);
  if (amount > 0 && stat) await db.insert(trainingLog).values({userId, stat: stat as (typeof CombatStatNames)[number], amount, speed: user.trainingSpeed});
  if (masteryAmount > 0 && mastery) await db.insert(trainingLog).values({userId, stat: mastery, amount: masteryAmount, speed: user.trainingSpeed});
}
console.log(`Settled ${pending.rows.length} training accounts`);

// Stage effective capacities before the SQL backfill so every account starts full,
// including accounts with Energy capacity bonuses. No gameplay writes may run here.
await db.execute(sql`CREATE TABLE IF NOT EXISTS _EnergyPool (userId varchar(191) PRIMARY KEY, capacity double NOT NULL)`);
const users = await db.query.userData.findMany({columns: {curEnergy: false, maxEnergy: false},
  with: {bloodline: true, userSkills: {where: eq(userSkill.activated, true), with: {skill: true}},
    items: {where: sql`${userItem.equipped} != 'NONE' AND ${userItem.quantity} > 0`, with: {item: true, imbuements: {with: {item: true}}}}}});
for (let offset = 0; offset < users.length; offset += 100) {
  const values = users.slice(offset, offset + 100).map(user => sql`(${user.userId}, ${calcMaxEnergy(user)})`);
  await db.execute(sql`INSERT INTO _EnergyPool (userId, capacity) VALUES ${sql.join(values, sql`, `)} ON DUPLICATE KEY UPDATE capacity = VALUES(capacity)`);
}
console.log(`Staged full Energy pools for ${users.length} accounts`);
