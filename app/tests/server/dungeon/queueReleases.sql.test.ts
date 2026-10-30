import { beforeEach, expect, it, afterEach, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { actionLog, aiProfile, battle, clan, dungeon, dungeonMember, dungeonRun, mpvpBattleQueue, mpvpBattleUser, petSpecies, quest, tournament, tournamentMatch, tournamentRecord, userData, userPet, userRewards, village } from "@/drizzle/schema";
import { updateUserDataForDeleteClanBattle, updateUserDataForRemoveFromClan, updateUserDataForRemoveFromClan2, updateUserDataForUndoClanBattleJoin } from "@/queries/clan";
import { updateUserDataForCheckAndCleanupExpiredRaid, updateUserDataForReadyToQueue, updateUserDataForRollbackStartRaidBattle } from "@/queries/raids";
import { updateUserDataForJoinMatch } from "@/queries/tournament";
import type { DrizzleClient } from "@/server/db";
import { clanRouter } from "@/server/api/routers/clan";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import { petsRouter } from "@/server/api/routers/pets";
import { raidsRouter, checkAndCleanupExpiredRaid } from "@/server/api/routers/raids";
import { RaidObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { combatRouter } from "@/server/api/routers/combat";
import { tournamentRouter } from "@/server/api/routers/tournament";
import { Pusher } from "@/libs/pusher";
import { makeCompleteBattle, makeUser } from "../../libs/combat/helpers/battleScenario";
import { dungeonContent } from "../../setup/dungeon";
import { insertPetSpecies, insertQuests, insertUsers } from "../../setup/factories";
import { initialPetSpecies } from "../../libs/pets/helpers/species";
import { stubRateLimitTransport } from "../../setup/rateLimit";
import { beforeStatements } from "../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("activity releases preserve dungeon reservations", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    vi.spyOn(Pusher.prototype,"trigger").mockResolvedValue(undefined);
    await resetTables(actionLog, aiProfile, battle, clan, dungeon, dungeonMember, dungeonRun, mpvpBattleQueue, mpvpBattleUser, petSpecies, quest, tournament, tournamentMatch, tournamentRecord, userData, userPet, userRewards, village);
    const db = await getTestDatabase();
    await db.insert(village).values({id:"v", name:"V", sector:1, kageId:"leader"});
    await db.insert(clan).values({id:"clan", name:"Clan", image:"/clan.webp", villageId:"v", founderId:"leader", leaderId:"leader", leaderOrderId:"order"});
    await insertUsers([{userId:"leader", username:"Leader", clanId:"clan", villageId:"v", rank:"JONIN", status:"AWAKE", sector:1}, {userId:"member", username:"Member", clanId:"clan", villageId:"v", rank:"JONIN", status:"AWAKE", sector:1}]);
    await insertPetSpecies(initialPetSpecies);
    await db.insert(userPet).values(["one","two"].map(id=>({id, userId:"member", name:id, speciesId:initialPetSpecies[0]!.id, paletteIndex:0, characteristicIndex:0, auraIndex:0, rank:1, artRank:1, generationStatus:"READY" as const, battleEnabled:true, avatar:"https://example.com/pet.webp"})));
    await db.insert(dungeon).values({id:"definition",content:dungeonContent(),updatedAt:new Date()});
  });
  afterEach(() => vi.restoreAllMocks());
  const releases = [
    ["clan join rollback", (db: DrizzleClient) => updateUserDataForUndoClanBattleJoin(db, "member")],
    ["clan removal", (db: DrizzleClient) => updateUserDataForRemoveFromClan(db, "member")],
    ["clan disband", (db: DrizzleClient) => updateUserDataForRemoveFromClan2(db, {id:"clan"}, "leader")],
    ["clan battle deletion", (db: DrizzleClient) => updateUserDataForDeleteClanBattle(db, {id:"old"})],
    ["raid readiness", (db: DrizzleClient) => updateUserDataForReadyToQueue(db, "member", {status:"QUEUED"})],
    ["raid expiry", (db: DrizzleClient) => updateUserDataForCheckAndCleanupExpiredRaid(db, ["member"])],
    ["raid start rollback", (db: DrizzleClient) => updateUserDataForRollbackStartRaidBattle(db, ["member"])],
    ["tournament first participant", (db: DrizzleClient) => updateUserDataForJoinMatch(db, {userId1:"member",userId2:"leader"})],
    ["tournament second participant", (db: DrizzleClient) => updateUserDataForJoinMatch(db, {userId1:"leader",userId2:"member"})],
  ] as const;
  it.each(releases)("%s preserves live dungeon queues and releases ordinary queues with terminal receipts", async (_name, release) => {
    const db = await getTestDatabase();
    expect((await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]})).success).toBe(true);
    // A retained roster with no live parent does not own QUEUED.
    await db.insert(mpvpBattleUser).values({id:"old-member",clanBattleId:"old",userId:"member",side:"ATTACKER",slot:0});
    for (const status of ["LOBBY","BETWEEN","PAUSED","FIGHTING","COMPLETED","ENDED",null] as const) {
      if (status) await db.update(dungeonRun).set({status});
      else await db.delete(dungeonMember);
      await db.update(userData).set({status:"QUEUED",clanId:"clan"}).where(eq(userData.userId,"member"));
      await release(db);
      const owner = await db.query.userData.findFirst({where:eq(userData.userId,"member")});
      expect(owner?.status).toBe(status && status !== "COMPLETED" && status !== "ENDED" ? "QUEUED" : "AWAKE");
      if (_name === "clan removal" || _name === "clan disband") expect(owner?.clanId).toBeNull();
    }
  });
  const createTournamentMatch = async (actor = "member") => {
    const db = await getTestDatabase();
    const startedAt = new Date(Date.now() - 10000);
    await db.insert(aiProfile).values({id:"Default",userId:"member",rules:[]});
    await db.insert(tournament).values({id:"tour",name:"Clan tournament",image:"/test.webp",description:"",type:"CLAN",status:"IN_PROGRESS",round:1,rewards:ObjectiveReward.parse({reward_money:1000}),startedAt,roundStartedAt:startedAt});
    await db.update(userData).set({money:0});
    await db.insert(tournamentMatch).values({id:"match",tournamentId:"tour",round:1,match:1,state:"WAITING",userId1:actor,userId2:actor === "member" ? "leader" : "member",startedAt});
  };
  it.each([
    ["member", "member"], ["member", "leader"],
    ["leader", "member"], ["leader", "leader"],
  ])("preserves a live dungeon without awarding a no-show when first seat is %s and caller is %s", async (firstSeat, actor) => {
    const db = await getTestDatabase();
    await createTournamentMatch(firstSeat);
    const created = await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]});
    expect(created.success).toBe(true);
    const pets = await callerFor(petsRouter,"member");
    expect((await pets.updatePet({petId:"one",battleEnabled:false})).success).toBe(false);
    const tournamentCaller = await callerFor(tournamentRouter,actor);
    expect((await tournamentCaller.joinMatch({matchId:"match",tournamentId:"tour"})).success).toBe(false);
    expect(await db.query.tournamentMatch.findFirst()).toMatchObject({state:"WAITING",winnerId:null,battleId:null});
    expect(await db.query.battle.findFirst()).toBeUndefined();
    await tournamentCaller.getTournament({tournamentId:"tour"});
    expect(await db.query.tournamentRecord.findFirst()).toBeUndefined();
    expect(await db.query.userData.findMany()).toEqual(expect.arrayContaining([expect.objectContaining({userId:"member",money:0}),expect.objectContaining({userId:"leader",money:0})]));
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"member")})).toMatchObject({status:"QUEUED",battleId:null});
    expect(await db.query.dungeonMember.findFirst()).toMatchObject({activeUserId:"member"});
    expect(await db.query.dungeonRun.findFirst()).toMatchObject({status:"LOBBY"});
    expect((await pets.updatePet({petId:"one",battleEnabled:false})).success).toBe(false);
  });
  it.each(["member", "leader"])("guards a no-show atomically when the first seat is %s and a dungeon joins during admission", async firstSeat => {
    const db = await getTestDatabase();
    await createTournamentMatch(firstSeat);
    await db.update(userData).set({isBanned:true}).where(eq(userData.userId,"member"));
    let admitted = false;
    const raced = beforeStatements(db, tournamentMatch, [async () => {
      await db.update(userData).set({isBanned:false}).where(eq(userData.userId,"member"));
      expect((await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]})).success).toBe(true);
      admitted = true;
    }]);
    const caller = callerForDatabase(tournamentRouter,"leader",raced);
    expect((await caller.joinMatch({matchId:"match",tournamentId:"tour"})).success).toBe(false);
    expect(admitted).toBe(true);
    expect(await db.query.tournamentMatch.findFirst()).toMatchObject({state:"WAITING",winnerId:null,battleId:null});
    expect((await caller.joinMatch({matchId:"match",tournamentId:"tour"})).success).toBe(false);
    await caller.getTournament({tournamentId:"tour"});
    expect(await db.query.tournamentRecord.findFirst()).toBeUndefined();
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"member")})).toMatchObject({status:"QUEUED",battleId:null,money:0});
    expect((await (await callerFor(petsRouter,"member")).updatePet({petId:"one",battleEnabled:false})).success).toBe(false);
  });
  it.each([false, true])("keeps a genuine tournament bye eligible with dungeon reservation %p", async reserved => {
    const db = await getTestDatabase();
    await createTournamentMatch();
    await db.update(tournamentMatch).set({userId2:null});
    if (reserved) expect((await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]})).success).toBe(true);
    expect((await (await callerFor(tournamentRouter,"member")).joinMatch({matchId:"match",tournamentId:"tour"})).success).toBe(true);
    expect(await db.query.tournamentMatch.findFirst()).toMatchObject({state:"NO_SHOW",winnerId:"member",battleId:null});
    if (reserved) {
      expect(await db.query.userData.findFirst({where:eq(userData.userId,"member")})).toMatchObject({status:"QUEUED",battleId:null});
      expect((await (await callerFor(petsRouter,"member")).updatePet({petId:"one",battleEnabled:false})).success).toBe(false);
    }
  });
  it("keeps ordinary two-player no-shows eligible without a dungeon reservation", async () => {
    const db = await getTestDatabase();
    await createTournamentMatch();
    await db.update(userData).set({isBanned:true}).where(eq(userData.userId,"member"));
    const caller = await callerFor(tournamentRouter,"leader");
    expect((await caller.joinMatch({matchId:"match",tournamentId:"tour"})).success).toBe(true);
    expect(await db.query.tournamentMatch.findFirst()).toMatchObject({state:"NO_SHOW",winnerId:"leader",battleId:null});
    await caller.getTournament({tournamentId:"tour"});
    expect(await db.query.tournamentRecord.findFirst()).toMatchObject({winnerId:"leader"});
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"leader")})).toMatchObject({money:1000});
  });
  it.each([null,"COMPLETED","ENDED"] as const)("starts ordinary tournament battles with dungeon receipt %s", async status => {
    const db = await getTestDatabase();
    await createTournamentMatch();
    if (status) {
      expect((await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]})).success).toBe(true);
      await db.update(dungeonRun).set({status});
    }
    const result = await (await callerFor(tournamentRouter,"leader")).joinMatch({matchId:"match",tournamentId:"tour"});
    expect(result.battleId).toBeString();
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"member")})).toMatchObject({status:"BATTLE",battleId:result.battleId});
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"leader")})).toMatchObject({status:"BATTLE",battleId:result.battleId});
  });
  it("keeps a clan-kicked solo player's dungeon queue and selected pets reserved", async () => {
    const db = await getTestDatabase();
    const member = await callerFor(dungeonRouter,"member");
    const created = await member.create({id:"definition",petIds:["one","two"]});
    expect(created.success).toBe(true);
    const pets = await callerFor(petsRouter,"member");
    expect((await pets.updatePet({petId:"one",battleEnabled:false})).success).toBe(false);
    await db.update(userData).set({isOutlaw:true}).where(eq(userData.userId,"member"));
    const kicked = await (await callerFor(clanRouter,"leader")).kickMember({clanId:"clan",memberId:"member"});
    expect(kicked.success).toBe(true);
    const owner = await db.query.userData.findFirst({where:eq(userData.userId,"member")});
    expect(owner).toMatchObject({clanId:null,villageId:VILLAGE_SYNDICATE_ID});
    const changed = await pets.updatePet({petId:"one",battleEnabled:false});
    expect(owner?.status).toBe("QUEUED");
    expect(changed.success).toBe(false);
  });
  it("keeps a low-rank member's dungeon queue when their clan disbands", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({rank:"STUDENT"}).where(eq(userData.userId,"member"));
    const created = await (await callerFor(dungeonRouter,"member")).create({id:"definition"});
    expect(created.success).toBe(true);
    await db.update(userData).set({isOutlaw:true}).where(eq(userData.userId,"member"));
    const left = await (await callerFor(clanRouter,"leader")).leaveClan({clanId:"clan"});
    expect(left.success).toBe(true);
    const owner = await db.query.userData.findFirst({where:eq(userData.userId,"member")});
    expect(owner).toMatchObject({clanId:null,villageId:VILLAGE_SYNDICATE_ID});
    expect(await db.query.clan.findFirst()).toBeUndefined();
    const changed = await (await callerFor(petsRouter,"member")).updatePet({petId:"one",battleEnabled:false});
    expect(owner?.status).toBe("QUEUED");
    expect(changed.success).toBe(false);
  });
  it.each(["leaveClanBattle","kickFromClanBattle","deleteClanBattle"] as const)("preserves a dungeon reservation when %s cleans a retained completed clan roster", async action => {
    const db = await getTestDatabase();
    await db.insert(mpvpBattleQueue).values({id:"old-clan-fight",battleType:"CLAN_BATTLE",attackerEntityId:"clan",defenderEntityId:"foe",winnerId:"clan",battleId:"completed-battle"});
    await db.insert(mpvpBattleUser).values({id:"old-member",clanBattleId:"old-clan-fight",userId:"member",side:"ATTACKER",slot:0});
    const created = await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]});
    expect(created.success).toBe(true);
    const leader = await callerFor(clanRouter,"leader");
    const result = action === "leaveClanBattle"
      ? await (await callerFor(clanRouter,"member")).leaveClanBattle({clanBattleId:"old-clan-fight"})
      : action === "kickFromClanBattle"
        ? await leader.kickFromClanBattle({clanBattleId:"old-clan-fight",clanId:"clan",targetId:"member"})
        : await leader.deleteClanBattle({clanBattleId:"old-clan-fight"});
    expect(result.success).toBe(true);
    expect(await db.query.mpvpBattleUser.findFirst()).toBeUndefined();
    const owner = await db.query.userData.findFirst({where:eq(userData.userId,"member")});
    const changed = await (await callerFor(petsRouter,"member")).updatePet({petId:"one",battleEnabled:false});
    expect(owner?.status).toBe("QUEUED");
    expect(changed.success).toBe(false);
  });
  it("preserves a dungeon reservation when readyToQueue sees a retained raid roster", async () => {
    const db = await getTestDatabase();
    await db.insert(mpvpBattleQueue).values({id:"old-raid-fight",battleType:"RAID_BATTLE",attackerEntityId:"raid",defenderEntityId:"raid",battleId:"ongoing-raid-battle",sector:1});
    await db.insert(mpvpBattleUser).values({id:"old-member",clanBattleId:"old-raid-fight",userId:"member",side:"ATTACKER",slot:0});
    const ongoing = makeCompleteBattle({id:"ongoing-raid-battle",battleType:"RAID",activeUserId:"leader",usersState:[makeUser({userId:"member",controllerId:"member",username:"Member",sector:1,direction:"left",fledBattle:true}),makeUser({userId:"leader",controllerId:"leader",username:"Leader",sector:1,direction:"left"}),makeUser({userId:"boss",controllerId:"boss",username:"Boss",sector:1,direction:"right",isAi:true})]});
    await db.insert(battle).values(ongoing);
    await db.update(userData).set({status:"BATTLE",battleId:ongoing.id}).where(eq(userData.userId,"member"));
    const settled = await (await callerFor(combatRouter,"member")).getBattle({battleId:ongoing.id});
    expect(settled.result).not.toBeNull();
    expect((await db.query.userData.findFirst({where:eq(userData.userId,"member")}))?.status).toBe("AWAKE");
    expect(await db.query.mpvpBattleUser.findFirst()).toBeDefined();
    expect(await db.query.battle.findFirst()).toBeDefined();
    const created = await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]});
    expect(created.success).toBe(true);
    const result = await (await callerFor(raidsRouter,"member")).readyToQueue();
    expect(result.success).toBe(false);
    const owner = await db.query.userData.findFirst({where:eq(userData.userId,"member")});
    const changed = await (await callerFor(petsRouter,"member")).updatePet({petId:"one",battleEnabled:false});
    expect(owner?.status).toBe("QUEUED");
    expect(changed.success).toBe(false);
  });
  it("preserves a new dungeon after a delayed duplicate expired raid cleanup", async () => {
    const db = await getTestDatabase();
    await insertQuests([{id:"raid",questType:"raid",raidEndsAt:new Date(Date.now()-1000),raidBossCurrentHealth:100}]);
    await db.insert(mpvpBattleQueue).values({id:"raid-team",battleType:"RAID_BATTLE",attackerEntityId:"raid",defenderEntityId:"raid",sector:1});
    await db.insert(mpvpBattleUser).values({id:"old-member",clanBattleId:"raid-team",userId:"member",side:"ATTACKER",slot:0});
    await db.update(userData).set({status:"QUEUED"}).where(eq(userData.userId,"member"));
    let interposed = false;
    // Both cleanups capture the same roster before the first releases it.
    const queue = new Proxy(db.query.mpvpBattleQueue,{get(target,key,receiver){
      if(key!=="findMany") return Reflect.get(target,key,receiver);
      return async (...args:Parameters<typeof target.findMany>)=>{
        const rows = await target.findMany(...args);
        if(!interposed){
          interposed=true;
          await checkAndCleanupExpiredRaid(db,"raid");
          const created=await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]});
          expect(created.success).toBe(true);
        }
        return rows;
      };
    }});
    const delayed=new Proxy(db,{get(target,key,receiver){return key==="query"?{...target.query,mpvpBattleQueue:queue}:Reflect.get(target,key,receiver);}});
    expect((await checkAndCleanupExpiredRaid(delayed,"raid")).wasExpired).toBe(true);
    expect(await db.query.mpvpBattleQueue.findFirst()).toBeUndefined();
    expect(await db.query.mpvpBattleUser.findFirst()).toBeUndefined();
    const owner=await db.query.userData.findFirst({where:eq(userData.userId,"member")});
    expect(owner?.status).toBe("QUEUED");
  });
  it("preserves a new dungeon when a leaving raider makes the old launcher roll back", async () => {
    const db = await getTestDatabase();
    await insertUsers([{userId:"boss",username:"Boss",isAi:true,rank:"GENIN",level:5,status:"AWAKE",inArena:true}]);
    await db.insert(aiProfile).values({id:"Default",userId:"default-ai",rules:[]});
    await insertQuests([{id:"raid",questType:"raid",raidBossCurrentHealth:100,raidBossMaxHealth:100,raidEndsAt:new Date(Date.now()+3600000),content:{objectives:[RaidObjective.parse({id:"raid-goal",task:"open_raid",sector:1,opponentAIs:[{ids:["boss"],number:100,quantity:1}]})],reward:ObjectiveReward.parse({}),sceneBackground:"",sceneCharacters:[]}}]);
    await db.insert(mpvpBattleQueue).values({id:"raid-team",battleType:"RAID_BATTLE",attackerEntityId:"raid",defenderEntityId:"raid",sector:1,createdAt:new Date(Date.now()-120000)});
    await db.insert(mpvpBattleUser).values({id:"old-member",clanBattleId:"raid-team",userId:"member",side:"ATTACKER",slot:0});
    await db.update(userData).set({status:"QUEUED"}).where(eq(userData.userId,"member"));
    let interposed = false;
    // The launcher captured this raider before they left and entered the dungeon.
    const users = new Proxy(db.query.userData,{get(target,key,receiver){
      if(key!=="findMany") return Reflect.get(target,key,receiver);
      return async (...args:Parameters<typeof target.findMany>)=>{
        if(!interposed){
          interposed=true;
          expect((await (await callerFor(raidsRouter,"member")).leaveRaidQueue()).success).toBe(true);
          expect((await (await callerFor(dungeonRouter,"member")).create({id:"definition",petIds:["one","two"]})).success).toBe(true);
        }
        return await target.findMany(...args);
      };
    }});
    const delayed=new Proxy(db,{get(target,key,receiver){return key==="query"?{...target.query,userData:users}:Reflect.get(target,key,receiver);}});
    const result=await callerForDatabase(raidsRouter,"member",delayed).startRaidBattle({teamId:"raid-team"});
    expect(result.success).toBe(false);
    expect(await db.query.mpvpBattleQueue.findFirst()).toBeUndefined();
    expect(await db.query.mpvpBattleUser.findFirst()).toBeUndefined();
    const owner=await db.query.userData.findFirst({where:eq(userData.userId,"member")});
    expect(owner?.status).toBe("QUEUED");
  });
});
