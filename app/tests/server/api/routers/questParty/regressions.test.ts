import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  item,
  overworldAiPlacement,
  quest,
  questHistory,
  questParty,
  type UserItem,
  user2conversation,
  userData,
  userItem,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { getNewTrackers } from "@/libs/quest";
import { getReward } from "@/libs/quest/rewards";
import { verifyQuestContentForSave } from "@/libs/quest/validation";
import { projectPartyTracker } from "@/libs/questParty";
import { questPartyRelations } from "@/queries/questParty";
import { overworldAiRouter } from "@/routers/overworldAi";
import { fetchUpdatedUser, profileRouter } from "@/routers/profile";
import { questPartyRouter } from "@/routers/questParty";
import { questsRouter } from "@/routers/quests";
import type { DrizzleClient } from "@/server/db";
import * as liveActivity from "@/server/utils/push/liveActivity";
import {
  commitQuestObjectiveRewards,
  handleQuestConsequences,
} from "@/server/utils/questConsequences";
import {
  type LoadedQuestParty,
  synchronizeQuestParty,
} from "@/server/utils/questParty";
import { AllObjectives, QuestTracker, QuestValidator } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { deferred } from "../../../../setup/deferred";
import {
  insertDefaultAiProfile,
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import {
  insertQuestTeamWorld,
  insertTeamQuest,
  questTeamMember,
  teamQuest,
} from "../../../../setup/questParty";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  aroundStatements,
  beforeStatements,
  failStatements,
} from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase(
  "quest team membership, departures, shared deliveries and outcomes",
  () => {
    beforeEach(async () => {
      await resetTables(
        questParty,
        quest,
        questHistory,
        userData,
        user2conversation,
        village,
        villageStructure,
        aiProfile,
        battle,
        battleHistory,
        overworldAiPlacement,
        item,
        userItem,
      );
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      stubRateLimitTransport();
      await insertQuestTeamWorld({ money: 100 });
    });
    afterEach(() => vi.restoreAllMocks());

    it.each([false, true])(
      "ends committed hospital recovery once when joining a team (roster conflict=%p)",
      async (conflict) => {
        const client = await getTestDatabase();
        const { party } = await claimReleaseFixture();
        const publication = vi
          .spyOn(liveActivity, "pushActivityUpdate")
          .mockResolvedValue(undefined);
        await client
          .update(userData)
          .set({
            status: "HOSPITALIZED",
            curHealth: 1,
            maxHealth: 100,
            regenAt: new Date(0),
          })
          .where(eq(userData.userId, "helper"));
        let interleaved = false;
        // Interleave at the roster claim, after the account recovery has committed.
        const joiningClient = aroundStatements(
          client,
          questParty,
          async (run) => {
            interleaved = true;
            await client
              .update(questParty)
              .set({ version: sql`${questParty.version} + 1` })
              .where(eq(questParty.id, party.id));
            return run();
          },
          {
            when: (set) =>
              conflict &&
              Array.isArray(set.memberIds) &&
              set.memberIds.includes("helper") &&
              !!set.battleId,
          },
        );
        const result = await callerForDatabase(
          questPartyRouter,
          "helper",
          joiningClient,
        ).join({ partyId: party.id });
        expect(interleaved).toBe(conflict);
        expect(result.success).toBe(!conflict);
        expect(result).toMatchObject({
          actionNotice: expect.stringContaining("checked you out"),
        });
        const saved = await client.query.userData.findFirst({
          where: eq(userData.userId, "helper"),
        });
        expect(saved).toMatchObject({
          status: "AWAKE",
          questPartyId: conflict ? null : party.id,
        });
        expect(publication).toHaveBeenCalledTimes(1);
        expect(publication).toHaveBeenCalledWith(
          joiningClient,
          ["helper"],
          "hospital",
          { title: "Recovered", endsAt: expect.any(Date) },
          "end",
        );
      },
    );

    it("preserves attached members when a progress preload omits their relation", async () => {
      const client = await getTestDatabase();
      const { party } = await lastMemberFixture();
      const loaded = (await client.query.questParty.findFirst({
        where: eq(questParty.id, party.id),
        with: questPartyRelations,
      }))!;
      const synchronized = await synchronizeQuestParty(client, {
        ...loaded,
        members: [],
      });
      expect(synchronized.memberIds).toEqual(["leader"]);
      expect(synchronized.leaderId).toBe("leader");
      expect(synchronized.members.map((member) => member.userId)).toEqual(["leader"]);
      expect((await client.query.questParty.findFirst())?.memberIds).toEqual([
        "leader",
      ]);
      await client
        .update(userData)
        .set({ status: "BATTLE", battleId: "ongoing" })
        .where(eq(userData.userId, "leader"));
      await client
        .update(questParty)
        .set({ battleId: "ongoing" })
        .where(eq(questParty.id, party.id));
      const fighting = (await client.query.questParty.findFirst({
        where: eq(questParty.id, party.id),
        with: questPartyRelations,
      }))!;
      const recovered = await synchronizeQuestParty(client, {
        ...fighting,
        members: [],
      });
      expect(recovered.battleId).toBe("ongoing");
      expect(recovered.members[0]?.status).toBe("BATTLE");
    });

    it("lets only the leader remove a member and preserves the removed member's solo progress", async () => {
      const client = await getTestDatabase();
      const { leader, helper, party } = await lastMemberFixture();
      expect((await helper.join({ partyId: party.id })).success).toBe(true);
      expect(
        (await helper.remove({ partyId: party.id, userId: "leader" })).success,
      ).toBe(false);
      expect(
        (await leader.remove({ partyId: party.id, userId: "leader" })).success,
      ).toBe(false);
      expect(
        (await leader.remove({ partyId: party.id, userId: "helper" })).success,
      ).toBe(true);
      const removed = (await client.query.userData.findFirst({
        where: eq(userData.userId, "helper"),
      }))!;
      expect(removed.questPartyId).toBeNull();
      expect(
        removed.questData?.find((tracker) => tracker.id === party.questId)?.goals[0]
          ?.value,
      ).toBe(40);
      expect(
        removed.questData?.find((tracker) => tracker.id === party.questId)?.party,
      ).toBeUndefined();
      expect(
        await client.query.user2conversation.findFirst({
          where: eq(user2conversation.userId, "helper"),
        }),
      ).toBeUndefined();
    });

    it("shows quest invitations in profile notifications until accepted", async () => {
      const { leader, helper, party } = await lastMemberFixture();
      expect(
        (await leader.invite({ partyId: party.id, username: "helper" })).success,
      ).toBe(true);
      const profile = await callerFor(profileRouter, "helper");
      expect((await profile.getUser()).notifications).toContainEqual(
        expect.objectContaining({ href: "/questteams", notificationCount: 1 }),
      );
      expect((await helper.join({ partyId: party.id })).success).toBe(true);
      expect((await profile.getUser()).notifications).toContainEqual(
        expect.objectContaining({ href: "/questteams", notificationCount: 0 }),
      );
    });

    for (const action of ["invite", "remove", "disband"] as const) {
      it(`keeps a committed ${action} successful when notification delivery fails`, async () => {
        const client = await getTestDatabase();
        const { leader, helper, party } = await claimReleaseFixture();
        if (action !== "invite")
          expect((await helper.join({ partyId: party.id })).success).toBe(true);
        vi.spyOn(Pusher.prototype, "trigger").mockRejectedValue(
          new Error("Notification unavailable"),
        );
        const result =
          action === "invite"
            ? await leader.invite({ partyId: party.id, username: "helper" })
            : action === "remove"
              ? await leader.remove({ partyId: party.id, userId: "helper" })
              : await leader.disband({ partyId: party.id });
        expect(result.success).toBe(true);
        const saved = await client.query.questParty.findFirst({
          where: eq(questParty.id, party.id),
        });
        if (action === "invite") expect(saved?.invitedUserIds).toContain("helper");
        else {
          const detached = await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          });
          expect(detached?.questPartyId).toBeNull();
          expect(
            detached?.questData?.find((tracker) => tracker.id === party.questId),
          ).toBeDefined();
          if (action === "remove") expect(saved?.memberIds).toEqual(["leader"]);
          else expect(saved).toBeUndefined();
        }
      });
    }

    it("only advertises collection to members with a real attempt on a finished team quest", async () => {
      const client = await getTestDatabase();
      await insertQuests([
        {
          id: "team-quest",
          questType: "event",
          teamEnabled: true,
          hidden: false,
          maxAttempts: 3,
          retryDelay: "none",
          content: {
            objectives: [
              AllObjectives.parse({ id: "goal", task: "stats_trained", value: 10 }),
            ],
            reward: ObjectiveReward.parse({ reward_money: 50 }),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      await insertQuestHistory([
        {
          id: "helper-receipt",
          userId: "helper",
          questId: "team-quest",
          questType: "event",
          completed: 1,
          previousCompletes: 1,
          previousAttempts: 1,
          endAt: new Date(),
        },
      ]);
      const leader = await callerFor(questPartyRouter, "leader");
      expect(
        (await leader.create({ questId: "team-quest", isPublic: true })).success,
      ).toBe(true);
      const party = (await client.query.questParty.findFirst())!;
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).join({ partyId: party.id })
        ).success,
      ).toBe(true);
      const tracker = structuredClone(party.tracker);
      tracker.goals[0]!.done = true;
      tracker.goals[0]!.value = 10;
      await client
        .update(questParty)
        .set({ tracker, version: party.version + 2 })
        .where(eq(questParty.id, party.id));
      const notice = expect.objectContaining({
        name: "Quest rewards waiting: open your Logbook",
        notificationCount: 1,
      });
      expect(
        (await (await callerFor(profileRouter, "leader")).getUser()).notifications,
      ).toContainEqual(notice);
      expect(
        (await (await callerFor(profileRouter, "helper")).getUser()).notifications,
      ).not.toContainEqual(notice);
    });

    it("keeps unclaimed reward choices available after the team disbands", async () => {
      const client = await getTestDatabase();
      await insertQuests([
        {
          id: "choice-quest",
          questType: "event",
          teamEnabled: true,
          hidden: false,
          maxAttempts: 3,
          retryDelay: "none",
          content: {
            objectives: [
              AllObjectives.parse({ id: "goal", task: "stats_trained", value: 10 }),
            ],
            reward: { ...ObjectiveReward.parse({ reward_money: 50, reward_exp: 100 }) },
            rewardMode: "choose",
            rewardPickCount: 1,
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      const leader = await callerFor(questPartyRouter, "leader");
      expect(
        (await leader.create({ questId: "choice-quest", isPublic: true })).success,
      ).toBe(true);
      const party = (await client.query.questParty.findFirst())!;
      const helper = await callerFor(questPartyRouter, "helper");
      expect((await helper.join({ partyId: party.id })).success).toBe(true);
      const tracker = structuredClone(party.tracker);
      tracker.goals[0]!.done = true;
      tracker.goals[0]!.value = 10;
      await client
        .update(questParty)
        .set({ tracker, version: party.version + 2 })
        .where(eq(questParty.id, party.id));
      expect((await leader.disband({ partyId: party.id })).success).toBe(true);
      expect(
        (await (await callerFor(profileRouter, "helper")).getUser()).notifications,
      ).toContainEqual(
        expect.objectContaining({ name: "Quest rewards waiting: open your Logbook" }),
      );
      const rewards = await callerFor(questsRouter, "helper");
      expect((await rewards.checkRewards({ questId: "choice-quest" })).success).toBe(
        true,
      );
      const offers = await rewards.getPendingRewardChoices();
      expect(offers).toHaveLength(1);
      expect(
        (
          await rewards.claimRewardChoice({
            questId: "choice-quest",
            choiceId: offers[0]!.choiceId,
            cardIds: ["reward_money"],
          })
        ).success,
      ).toBe(true);
      expect(await rewards.getPendingRewardChoices()).toHaveLength(0);
      expect(
        (
          await rewards.claimRewardChoice({
            questId: "choice-quest",
            choiceId: offers[0]!.choiceId,
            cardIds: ["reward_money"],
          })
        ).success,
      ).toBe(false);
    });

    for (const failure of [
      "personal save",
      "personal contention",
      "chat removal",
      "party deletion",
    ] as const) {
      it(`retains the last member's shared progress through ${failure} failure and retry`, async () => {
        const client = await getTestDatabase();
        const { leader, party } = await lastMemberFixture();
        const receipt = await client.query.questHistory.findFirst({
          where: eq(questHistory.userId, "leader"),
        });
        let failedWrites = 0;
        const failing = failure.startsWith("personal")
          ? aroundStatements(
              client,
              userData,
              async () => {
                failedWrites++;
                if (failure === "personal contention") return { rowsAffected: 0 };
                throw new Error("Statement failed on purpose");
              },
              { operations: ["update"] },
            )
          : failStatements(
              client,
              failure === "chat removal" ? user2conversation : questParty,
              Infinity,
              { operations: ["delete"] },
            );
        await expect(
          callerForDatabase(questPartyRouter, "leader", failing).leave({
            partyId: party.id,
          }),
        ).rejects.toThrow(
          failure === "personal contention"
            ? "Character changed repeatedly"
            : "Statement failed on purpose",
        );
        if (failure.startsWith("personal"))
          expect(failedWrites).toBe(failure === "personal contention" ? 5 : 1);
        const retained = await client.query.questParty.findFirst();
        expect(retained?.tracker.goals[0]?.value).toBe(40);
        expect(retained?.battleId).toBeNull();
        // A profile read may reconcile the now-detached roster before cleanup retries.
        await fetchUpdatedUser({ client, userId: "leader" });
        expect((await leader.leave({ partyId: party.id })).success).toBe(true);
        const detached = await client.query.userData.findFirst({
          where: eq(userData.userId, "leader"),
        });
        expect(detached?.questPartyId).toBeNull();
        expect(detached?.money).toBe(100);
        expect(
          detached?.questData?.find((entry) => entry.id === "team-quest")?.goals[0]
            ?.value,
        ).toBe(40);
        expect(
          detached?.questData?.find((entry) => entry.id === "team-quest")?.party,
        ).toBeUndefined();
        expect(
          detached?.questData?.find((entry) => entry.id === "unrelated")?.goals[0]
            ?.collected,
        ).toBe(true);
        expect(
          await client.query.questHistory.findFirst({
            where: eq(questHistory.userId, "leader"),
          }),
        ).toEqual(receipt);
        expect(await client.query.questParty.findFirst()).toBeUndefined();
        expect(
          await client.query.user2conversation.findFirst({
            where: eq(user2conversation.userId, "leader"),
          }),
        ).toBeUndefined();
      });
    }

    it("guards the last departure against joins and encounters until its personal save commits", async () => {
      const client = await getTestDatabase();
      const { leader, helper, party } = await lastMemberFixture();
      let checked = false;
      const paused = beforeStatements(
        client,
        userData,
        [
          async () => {
            checked = true;
            expect((await client.query.questParty.findFirst())?.battleId).toMatch(
              /^claiming:/,
            );
            expect((await helper.join({ partyId: party.id })).success).toBe(false);
            expect((await leader.startEncounter({ partyId: party.id })).success).toBe(
              false,
            );
            expect((await leader.disband({ partyId: party.id })).success).toBe(false);
          },
        ],
        { operations: ["update"] },
      );
      expect(
        (
          await callerForDatabase(questPartyRouter, "leader", paused).leave({
            partyId: party.id,
          })
        ).success,
      ).toBe(true);
      expect(checked).toBe(true);
      expect(await client.query.questParty.findFirst()).toBeUndefined();
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "leader"),
          })
        )?.questData?.find((entry) => entry.id === "team-quest")?.goals[0]?.value,
      ).toBe(40);
    });

    it("keeps a concurrent progress sync from restoring a released departure claim", async () => {
      const client = await getTestDatabase();
      const { leader, party } = await lastMemberFixture();
      const member = (await client.query.userData.findFirst({
        where: eq(userData.userId, "leader"),
      }))!;
      const trackers = structuredClone(member.questData!);
      const tracker = trackers.find((entry) => entry.id === "team-quest")!;
      tracker.goals[0]!.value += 10;
      tracker.party!.contributions = [{ ...tracker.goals[0]!, value: 10 }];
      let concurrentSnapshot: LoadedQuestParty | undefined;
      const failing = aroundStatements(
        client,
        userData,
        async () => {
          await client
            .update(userData)
            .set({ questData: trackers, updatedAt: new Date() })
            .where(eq(userData.userId, "leader"));
          concurrentSnapshot = await client.query.questParty.findFirst({
            where: eq(questParty.id, party.id),
            with: questPartyRelations,
          });
          throw new Error("Injected departure failure");
        },
        { operations: ["update"] },
      );
      await expect(
        callerForDatabase(questPartyRouter, "leader", failing).leave({
          partyId: party.id,
        }),
      ).rejects.toThrow("Injected departure failure");
      expect(concurrentSnapshot?.battleId).toMatch(/^claiming:/);
      expect((await client.query.questParty.findFirst())?.battleId).toBeNull();
      if (!concurrentSnapshot) throw new Error("Missing concurrent party snapshot");
      const synchronized = await synchronizeQuestParty(client, concurrentSnapshot);
      expect(synchronized.battleId).toBeNull();
      expect(synchronized.tracker.goals[0]?.value).toBe(50);
      expect((await leader.leave({ partyId: party.id })).success).toBe(true);
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "leader"),
          })
        )?.questData?.find((entry) => entry.id === "team-quest")?.goals[0]?.value,
      ).toBe(50);
    });

    it("keeps successful joins usable after a delayed member acknowledgement", async () => {
      const client = await getTestDatabase();
      const { leader, party } = await claimReleaseFixture();
      let concurrentSnapshot: LoadedQuestParty | undefined;
      const paused = aroundStatements(
        client,
        questParty,
        async (run) => {
          concurrentSnapshot = await client.query.questParty.findFirst({
            where: eq(questParty.id, party.id),
            with: questPartyRelations,
          });
          return run();
        },
        { when: (set) => set.battleId === null },
      );
      expect(
        (
          await callerForDatabase(questPartyRouter, "helper", paused).join({
            partyId: party.id,
          })
        ).success,
      ).toBe(true);
      expect((await client.query.questParty.findFirst())?.battleId).toBeNull();
      expect(concurrentSnapshot?.battleId).toMatch(/^claiming:/);
      if (!concurrentSnapshot) throw new Error("Missing concurrent join snapshot");
      const synchronized = await synchronizeQuestParty(client, concurrentSnapshot);
      expect(synchronized.battleId).toBeNull();
      expect(synchronized.memberIds).toEqual(["leader", "helper"]);
      expect((await client.query.questParty.findFirst())?.battleId).toBeNull();
      expect((await leader.startEncounter({ partyId: party.id })).message).toBe(
        "There is no active combat objective",
      );
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).leave({ partyId: party.id })
        ).success,
      ).toBe(true);
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          })
        )?.questPartyId,
      ).toBeNull();
    });

    it("allows immediate disband recovery after partial detachment and a delayed roster sync", async () => {
      const client = await getTestDatabase();
      const { leader, helper, party } = await claimReleaseFixture();
      expect((await helper.join({ partyId: party.id })).success).toBe(true);
      let concurrentSnapshot: LoadedQuestParty | undefined;
      const { promise: detached, resolve: helperDetached } = deferred<void>();
      const failing = new Proxy(client, {
        get(target, key, receiver) {
          if (key === "update")
            return (table: unknown) => {
              if (table !== userData) return target.update(table as typeof questParty);
              const write = target.update(userData);
              return {
                set: (...values: Parameters<typeof write.set>) => {
                  const pending = write.set(...values);
                  return {
                    where: async (...conditions: Parameters<typeof pending.where>) => {
                      const guarded = pending.where(...conditions);
                      if (values[0].questPartyId !== null) return guarded;
                      if (guarded.toSQL().params.includes("helper")) {
                        const result = await guarded;
                        helperDetached();
                        return result;
                      }
                      await detached;
                      concurrentSnapshot = await client.query.questParty.findFirst({
                        where: eq(questParty.id, party.id),
                        with: questPartyRelations,
                      });
                      throw new Error("Injected leader detachment failure");
                    },
                  };
                },
              };
            };
          return Reflect.get(target, key, receiver);
        },
      }) as DrizzleClient;
      await expect(
        callerForDatabase(questPartyRouter, "leader", failing).disband({
          partyId: party.id,
        }),
      ).rejects.toThrow("Injected leader detachment failure");
      expect((await client.query.questParty.findFirst())?.battleId).toBeNull();
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          })
        )?.questPartyId,
      ).toBeNull();
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "leader"),
          })
        )?.questPartyId,
      ).toBe(party.id);
      expect(concurrentSnapshot?.battleId).toMatch(/^claiming:/);
      if (!concurrentSnapshot) throw new Error("Missing concurrent disband snapshot");
      const synchronized = await synchronizeQuestParty(client, concurrentSnapshot);
      expect(synchronized.memberIds).toEqual(["leader"]);
      expect(synchronized.battleId).toBeNull();
      expect(await client.query.battle.findFirst()).toBeUndefined();
      expect((await leader.disband({ partyId: party.id })).success).toBe(true);
      expect(await client.query.questParty.findFirst()).toBeUndefined();
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "leader"),
          })
        )?.questPartyId,
      ).toBeNull();
    });

    it("recovers an abandoned departure claim after the personal save and roster reconciliation", async () => {
      const client = await getTestDatabase();
      const { leader, party } = await lastMemberFixture();
      const failWith = (message: string) => async () => {
        throw new Error(message);
      };
      const interrupted = aroundStatements(
        aroundStatements(
          client,
          questParty,
          failWith("Injected claim recovery failure"),
          { when: (set) => set.battleId === null },
        ),
        questParty,
        failWith("Injected party deletion failure"),
        { operations: ["delete"] },
      );
      await expect(
        callerForDatabase(questPartyRouter, "leader", interrupted).leave({
          partyId: party.id,
        }),
      ).rejects.toThrow("Injected claim recovery failure");
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "leader"),
          })
        )?.questPartyId,
      ).toBeNull();
      // A retry during the claim grace reconciles the detached roster but keeps its live lock.
      expect((await leader.leave({ partyId: party.id })).success).toBe(false);
      const reserved = (await client.query.questParty.findFirst())!;
      expect(reserved.memberIds).toEqual([]);
      expect(reserved.battleId).toMatch(/^claiming:/);
      await client
        .update(questParty)
        .set({
          battleId: `claiming:${Date.now() - 120_000}:${reserved.battleId!.split(":")[2]}`,
          version: reserved.version + 1,
        })
        .where(eq(questParty.id, party.id));
      expect((await leader.leave({ partyId: party.id })).success).toBe(true);
      expect(await client.query.questParty.findFirst()).toBeUndefined();
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "leader"),
          })
        )?.questData?.find((entry) => entry.id === "team-quest")?.goals[0]?.value,
      ).toBe(40);
    });

    it.each([false, true])(
      "retries personal detachment after roster removal fails to save the member (completed helper=%p)",
      async (completed) => {
        const client = await getTestDatabase();
        await insertTeamQuest(
          [
            AllObjectives.parse({
              id: "paid",
              task: "stats_trained",
              value: 10,
              reward_money: 25,
            }),
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ],
          { maxAttempts: 3, maxCompletes: 3 },
        );
        if (completed)
          await insertQuestHistory([
            {
              id: "helper-receipt",
              userId: "helper",
              questId: "team-quest",
              questType: "event",
              completed: 1,
              previousCompletes: 1,
              endAt: new Date(),
            },
          ]);
        const leader = await callerFor(questPartyRouter, "leader");
        const helper = await callerFor(questPartyRouter, "helper");
        expect(
          (await leader.create({ questId: "team-quest", isPublic: true })).success,
        ).toBe(true);
        const party = (await client.query.questParty.findFirst())!;
        expect((await helper.join({ partyId: party.id })).success).toBe(true);
        party.tracker.goals = party.tracker.goals.map((goal) => ({
          ...goal,
          value: goal.id === "paid" ? 10 : 40,
          done: goal.id === "paid",
        }));
        await client
          .update(questParty)
          .set({ tracker: party.tracker })
          .where(eq(questParty.id, party.id));
        const personal = projectPartyTracker(party);
        personal.goals = personal.goals.map((goal) => ({
          ...goal,
          collected: goal.id === "paid",
        }));
        await client
          .update(userData)
          .set({ questData: [personal] })
          .where(eq(userData.userId, "helper"));
        const receipt = await client.query.questHistory.findFirst({
          where: eq(questHistory.userId, "helper"),
        });
        const failing = failStatements(client, userData, Infinity, {
          operations: ["update"],
        });
        await expect(
          callerForDatabase(questPartyRouter, "helper", failing).leave({
            partyId: party.id,
          }),
        ).rejects.toThrow("Statement failed on purpose");
        expect((await client.query.questParty.findFirst())?.memberIds).toEqual([
          "leader",
        ]);
        expect(
          (
            await client.query.userData.findFirst({
              where: eq(userData.userId, "helper"),
            })
          )?.questPartyId,
        ).toBe(party.id);
        if (completed)
          await client
            .update(userData)
            .set({ updatedAt: new Date(Date.now() - 120_000) })
            .where(eq(userData.userId, "helper"));
        await fetchUpdatedUser({ client, userId: "helper" });
        expect((await helper.leave({ partyId: party.id })).success).toBe(true);
        const detached = await client.query.userData.findFirst({
          where: eq(userData.userId, "helper"),
        });
        expect(detached?.questPartyId).toBeNull();
        expect(detached?.money).toBe(100);
        expect(
          await client.query.questHistory.findFirst({
            where: eq(questHistory.userId, "helper"),
          }),
        ).toEqual(receipt);
        const tracker = detached?.questData?.find((entry) => entry.id === "team-quest");
        expect(tracker?.party).toBeUndefined();
        expect(tracker?.goals.find((goal) => goal.id === "wait")?.value).toBe(40);
        if (!completed)
          expect(tracker?.goals.find((goal) => goal.id === "paid")?.collected).toBe(
            true,
          );
        expect((await client.query.questParty.findFirst())?.tracker).toEqual(
          party.tracker,
        );
        expect(
          (await helper.create({ questId: "team-quest", isPublic: true })).success,
        ).toBe(true);
      },
    );

    it("does not detach an in-flight join reservation before its roster CAS", async () => {
      const client = await getTestDatabase();
      await insertQuests([
        {
          id: "team-quest",
          questType: "event",
          teamEnabled: true,
          hidden: false,
          maxAttempts: 3,
          retryDelay: "none",
        },
      ]);
      expect(
        (
          await (
            await callerFor(questPartyRouter, "leader")
          ).create({ questId: "team-quest", isPublic: true })
        ).success,
      ).toBe(true);
      const party = (await client.query.questParty.findFirst())!;
      await client
        .update(userData)
        .set({ questPartyId: party.id, updatedAt: new Date() })
        .where(eq(userData.userId, "helper"));
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).leave({ partyId: party.id })
        ).success,
      ).toBe(false);
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          })
        )?.questPartyId,
      ).toBe(party.id);
      expect((await client.query.questParty.findFirst())?.memberIds).toEqual([
        "leader",
      ]);
    });

    for (const departure of ["leave", "disband"] as const) {
      for (const refreshed of [false, true]) {
        it(`reconciles personal effects after ${departure} (${refreshed ? "already applied" : "unrefreshed"})`, async () => {
          const client = await getTestDatabase();
          const { leader, helper, party } = await collectionChainFixture();
          await client
            .update(userData)
            .set({ longitude: 11 })
            .where(eq(userData.userId, "leader"));
          await (await callerFor(questsRouter, "leader")).checkLocationQuest();
          const canonical = (await client.query.questParty.findFirst())!;
          expect(
            canonical.tracker.goals.find((goal) => goal.id === "collect")?.done,
          ).toBe(true);
          expect(canonical.tracker.goals.find((goal) => goal.id === "next")?.done).toBe(
            true,
          );
          const unrefreshed = (await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          }))!;
          expect(
            unrefreshed.questData
              ?.find((tracker) => tracker.id === "team-quest")
              ?.goals.find((goal) => goal.id === "collect")?.done,
          ).toBe(false);
          expect(
            await client.query.userItem.findMany({
              where: eq(userItem.userId, "helper"),
            }),
          ).toHaveLength(0);
          if (refreshed) await fetchUpdatedUser({ client, userId: "helper" });
          const before = await client.query.userItem.findMany({
            where: eq(userItem.userId, "helper"),
          });
          expect(before).toHaveLength(refreshed ? 1 : 0);
          const receipt = await client.query.questHistory.findFirst({
            where: and(
              eq(questHistory.userId, "helper"),
              eq(questHistory.questId, "team-quest"),
            ),
          });
          const actor = departure === "leave" ? helper : leader;
          expect((await actor[departure]({ partyId: party.id })).success).toBe(true);
          const detached = (await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          }))!;
          const tracker = detached.questData?.find(
            (entry) => entry.id === "team-quest",
          );
          expect(detached.questPartyId).toBeNull();
          expect(tracker?.party).toBeUndefined();
          expect(tracker?.goals.find((goal) => goal.id === "collect")).toMatchObject({
            done: true,
            partyEffectsApplied: refreshed,
          });
          expect(tracker?.goals.find((goal) => goal.id === "next")).toMatchObject({
            done: true,
            partyEffectsApplied: refreshed,
          });
          await continueCollectionChainSolo(refreshed ? before : undefined);
          expect(
            await client.query.questHistory.findFirst({
              where: eq(questHistory.id, receipt!.id),
            }),
          ).toEqual(receipt);
        });
      }

      it(`applies inherited unfinished effects once during solo continuation after ${departure}`, async () => {
        const client = await getTestDatabase();
        const { leader, helper, party } = await collectionChainFixture();
        const actor = departure === "leave" ? helper : leader;
        expect((await actor[departure]({ partyId: party.id })).success).toBe(true);
        const detached = (await client.query.userData.findFirst({
          where: eq(userData.userId, "helper"),
        }))!;
        expect(
          detached.questData
            ?.find((tracker) => tracker.id === "team-quest")
            ?.goals.find((goal) => goal.id === "collect"),
        ).toMatchObject({ done: false, partyEffectsApplied: false });
        await client
          .update(userData)
          .set({ longitude: 11 })
          .where(eq(userData.userId, "helper"));
        expect(
          (await (await callerFor(questsRouter, "helper")).checkLocationQuest())
            .success,
        ).toBe(true);
        const collected = await client.query.userItem.findMany({
          where: eq(userItem.userId, "helper"),
        });
        expect(collected).toHaveLength(1);
        await continueCollectionChainSolo(collected);
      });
    }

    for (const task of ["collect_item", "deliver_item"] as const) {
      for (const advanced of [false, true]) {
        const departures = advanced
          ? ([null] as const)
          : ([null, "leave", "disband"] as const);
        for (const departure of departures) {
          it(`preserves personal inventory effects when joining ${advanced ? "a completed" : "an unfinished"} team goal (${task}, ${departure ?? "attached"})`, async () => {
            const client = await getTestDatabase();
            await insertItems([{ id: "scroll" }]);
            await insertTeamQuest(
              [
                AllObjectives.parse({
                  id: "inventory",
                  task,
                  ...(task === "collect_item"
                    ? { collectItemIds: ["scroll"] }
                    : { deliverItemIds: ["scroll"] }),
                  item_name: "Scroll",
                  sector: 50,
                  longitude: 11,
                  latitude: 10,
                  sectorType: "specific",
                  locationType: "specific",
                  nextObjectiveId: "wait",
                }),
                AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
              ],
              { consecutiveObjectives: true, maxAttempts: 3, maxCompletes: 3 },
            );
            const leader = await callerFor(questPartyRouter, "leader");
            expect(
              (await leader.create({ questId: "team-quest", isPublic: true })).success,
            ).toBe(true);
            if (advanced) {
              if (task === "deliver_item")
                await insertUserItems([
                  { id: "leader-copy", userId: "leader", itemId: "scroll" },
                ]);
              await client
                .update(userData)
                .set({ longitude: 11 })
                .where(eq(userData.userId, "leader"));
              await (await callerFor(questsRouter, "leader")).checkLocationQuest();
            }
            if (task === "deliver_item")
              await insertUserItems(
                [1, 2].map((copy) => ({
                  id: `helper-copy-${copy}`,
                  userId: "helper",
                  itemId: "scroll",
                })),
              );
            const personal = await callerFor(questsRouter, "helper");
            expect(
              (await personal.startQuest({ questId: "team-quest", userSector: 50 }))
                .success,
            ).toBe(true);
            await client
              .update(userData)
              .set({ longitude: 11 })
              .where(eq(userData.userId, "helper"));
            await personal.checkLocationQuest();
            const before = await client.query.userItem.findMany({
              where: eq(userItem.userId, "helper"),
            });
            expect(before).toHaveLength(1);
            const party = await client.query.questParty.findFirst();
            if (!party) throw new Error("Missing inventory team fixture");
            expect(
              party.tracker.goals.find((goal) => goal.id === "inventory")?.done,
            ).toBe(advanced);
            expect(
              (
                await (
                  await callerFor(questPartyRouter, "helper")
                ).join({ partyId: party.id })
              ).success,
            ).toBe(true);
            const joined = await client.query.userData.findFirst({
              where: eq(userData.userId, "helper"),
            });
            expect(
              joined?.questData
                ?.find((tracker) => tracker.id === "team-quest")
                ?.goals.find((goal) => goal.id === "inventory"),
            ).toMatchObject({ done: advanced, partyEffectsApplied: true });
            if (departure) {
              const actor =
                departure === "leave"
                  ? await callerFor(questPartyRouter, "helper")
                  : leader;
              expect((await actor[departure]({ partyId: party.id })).success).toBe(
                true,
              );
            }
            const profile = await callerFor(profileRouter, "helper");
            for (let read = 0; read < 2; read++) {
              await profile.getUser();
              await personal.checkLocationQuest();
              await personal.checkRewards({ questId: "team-quest" });
              expect(
                await client.query.userItem.findMany({
                  where: eq(userItem.userId, "helper"),
                }),
              ).toEqual(before);
            }
            expect(
              await client.query.questHistory.findFirst({
                where: eq(questHistory.userId, "helper"),
              }),
            ).toMatchObject({ previousAttempts: 1, completed: 0, endAt: null });
            const saved = await client.query.userData.findFirst({
              where: eq(userData.userId, "helper"),
            });
            expect(saved?.questPartyId).toBe(departure ? null : party.id);
            expect(
              saved?.questData
                ?.find((tracker) => tracker.id === "team-quest")
                ?.goals.find((goal) => goal.id === "inventory")?.done,
            ).toBe(true);
            if (departure) {
              expect(
                saved?.questData?.find((tracker) => tracker.id === "team-quest")?.party,
              ).toBeUndefined();
              return;
            }
            expect(
              (await client.query.questParty.findFirst())?.tracker.goals.find(
                (goal) => goal.id === "inventory",
              )?.done,
            ).toBe(true);
            for (const userId of ["fresh", "replacement"]) {
              await insertUsers([questTeamMember(userId)]);
              if (task === "deliver_item")
                await insertUserItems([
                  { id: `${userId}-copy`, userId, itemId: "scroll" },
                ]);
              const newcomer = await callerFor(questPartyRouter, userId);
              expect((await newcomer.join({ partyId: party.id })).success).toBe(true);
              for (let read = 0; read < 2; read++) {
                await (await callerFor(profileRouter, userId)).getUser();
                const items = await client.query.userItem.findMany({
                  where: eq(userItem.userId, userId),
                });
                expect(items).toHaveLength(task === "collect_item" ? 1 : 0);
              }
              if (userId === "fresh")
                expect((await newcomer.leave({ partyId: party.id })).success).toBe(
                  true,
                );
            }
          });
        }
      }
    }

    it("retires finished crafted delivery copies while preserving unfinished crafts", async () => {
      const client = await getTestDatabase();
      await insertItems([{ id: "scroll", canBeCrafted: true }]);
      await insertTeamQuest(
        [
          AllObjectives.parse({
            id: "delivery",
            task: "deliver_item",
            deliverItemIds: ["scroll"],
            item_name: "Scroll",
            sector: 50,
            longitude: 11,
            latitude: 10,
            sectorType: "specific",
            locationType: "specific",
            nextObjectiveId: "wait",
          }),
          AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
        ],
        { consecutiveObjectives: true, maxAttempts: 3, maxCompletes: 3 },
      );
      expect(
        (
          await (
            await callerFor(questPartyRouter, "leader")
          ).create({ questId: "team-quest", isPublic: true })
        ).success,
      ).toBe(true);
      const party = (await client.query.questParty.findFirst())!;
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).join({ partyId: party.id })
        ).success,
      ).toBe(true);
      await insertUserItems([
        { id: "leader-copy", userId: "leader", itemId: "scroll" },
        {
          id: "helper-finished",
          userId: "helper",
          itemId: "scroll",
          craftingFinishedAt: new Date(Date.now() - 60_000),
        },
        {
          id: "helper-crafting",
          userId: "helper",
          itemId: "scroll",
          craftingFinishedAt: new Date(Date.now() + 60_000),
        },
      ]);
      await client
        .update(userData)
        .set({ longitude: 11 })
        .where(eq(userData.userId, "leader"));
      expect(
        (await (await callerFor(questsRouter, "leader")).checkLocationQuest()).success,
      ).toBe(true);
      expect(
        await client.query.userItem.findMany({ where: eq(userItem.userId, "leader") }),
      ).toHaveLength(0);
      expect(
        (await client.query.questParty.findFirst())?.tracker.goals.find(
          (goal) => goal.id === "delivery",
        )?.done,
      ).toBe(true);
      const profile = await callerFor(profileRouter, "helper");
      for (let read = 0; read < 2; read++) {
        await profile.getUser();
        const saved = await client.query.userData.findFirst({
          where: eq(userData.userId, "helper"),
        });
        expect(
          saved?.questData
            ?.find((tracker) => tracker.id === "team-quest")
            ?.goals.find((goal) => goal.id === "delivery"),
        ).toMatchObject({ done: true, partyEffectsApplied: true });
        const inventory = await client.query.userItem.findMany({
          where: eq(userItem.userId, "helper"),
        });
        expect(inventory.map((row) => row.id)).toEqual(["helper-crafting"]);
      }
    });

    for (const mode of ["existing member", "replacement"] as const) {
      for (const secondId of ["scroll", "second-scroll"]) {
        it(`continues repeated collection and delivery after the collector leaves (${mode}, ${secondId})`, async () => {
          const client = await getTestDatabase();
          await insertItems([{ id: "scroll" }, { id: "second-scroll" }]);
          // Array order is independent of the authored links, including the selected dialog branch.
          const objectives = [
            AllObjectives.parse({
              id: "collect2",
              task: "collect_item",
              collectItemIds: [secondId],
              item_name: "New scroll",
              sector: 50,
              longitude: 13,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "deliver2",
            }),
            AllObjectives.parse({
              id: "deliver2",
              task: "deliver_item",
              deliverItemIds: [secondId],
              item_name: "New scroll",
              sector: 50,
              longitude: 14,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "wait",
            }),
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
            AllObjectives.parse({
              id: "choice",
              task: "dialog",
              nextObjectiveId: [
                { text: "Collect another scroll", nextObjectiveId: "collect2" },
                { text: "Train instead", nextObjectiveId: "skip" },
              ],
            }),
            AllObjectives.parse({
              id: "skip",
              task: "stats_trained",
              value: 100,
              nextObjectiveId: "wait",
            }),
            AllObjectives.parse({
              id: "collect1",
              task: "collect_item",
              collectItemIds: ["scroll"],
              item_name: "Scroll",
              sector: 50,
              longitude: 11,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "deliver1",
            }),
            AllObjectives.parse({
              id: "deliver1",
              task: "deliver_item",
              deliverItemIds: ["scroll"],
              item_name: "Scroll",
              sector: 50,
              longitude: 12,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "choice",
            }),
          ];
          expect(verifyQuestContentForSave(objectives, true).check).toBe(true);
          await insertTeamQuest(objectives, {
            consecutiveObjectives: true,
            maxAttempts: 3,
            maxCompletes: 3,
          });
          expect(
            QuestValidator.safeParse(await client.query.quest.findFirst()).success,
          ).toBe(true);
          const leader = await callerFor(questPartyRouter, "leader");
          const helper = await callerFor(questPartyRouter, "helper");
          expect(
            (await leader.create({ questId: "team-quest", isPublic: true })).success,
          ).toBe(true);
          const party = (await client.query.questParty.findFirst())!;
          if (mode === "existing member")
            expect((await helper.join({ partyId: party.id })).success).toBe(true);
          const leaderQuest = await callerFor(questsRouter, "leader");
          const helperQuest = await callerFor(questsRouter, "helper");
          await client
            .update(userData)
            .set({ longitude: 11 })
            .where(eq(userData.userId, "leader"));
          expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
          if (mode === "existing member") {
            await fetchUpdatedUser({ client, userId: "helper" });
            expect(
              await client.query.userItem.findMany({
                where: eq(userItem.userId, "helper"),
              }),
            ).toHaveLength(1);
          }
          await client
            .update(userData)
            .set({ longitude: 12 })
            .where(eq(userData.userId, "leader"));
          expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
          if (mode === "existing member") {
            await fetchUpdatedUser({ client, userId: "helper" });
            expect(
              await client.query.userItem.findMany({
                where: eq(userItem.userId, "helper"),
              }),
            ).toHaveLength(0);
          }
          expect(
            (
              await leaderQuest.checkRewards({
                questId: "team-quest",
                nextObjectiveId: "collect2",
              })
            ).success,
          ).toBe(true);
          await client
            .update(userData)
            .set({ longitude: 13 })
            .where(eq(userData.userId, "leader"));
          expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
          expect(
            (await client.query.questParty.findFirst())?.tracker.goals.find(
              (goal) => goal.id === "collect2",
            )?.done,
          ).toBe(true);
          if (mode === "replacement")
            expect((await helper.join({ partyId: party.id })).success).toBe(true);
          expect((await leader.leave({ partyId: party.id })).success).toBe(true);
          for (let read = 0; read < 2; read++) {
            await fetchUpdatedUser({ client, userId: "helper" });
            const copies = await client.query.userItem.findMany({
              where: eq(userItem.userId, "helper"),
            });
            expect(copies).toHaveLength(1);
            expect(copies[0]).toMatchObject({ itemId: secondId, quantity: 1 });
          }
          const personal = (await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          }))!;
          expect(
            personal.questData
              ?.find((tracker) => tracker.id === "team-quest")
              ?.goals.find((goal) => goal.id === "collect2"),
          ).toMatchObject({ done: true, partyEffectsApplied: true });
          await client
            .update(userData)
            .set({ longitude: 14 })
            .where(eq(userData.userId, "helper"));
          expect((await helperQuest.checkLocationQuest()).success).toBe(true);
          expect(
            (await client.query.questParty.findFirst())?.tracker.goals.find(
              (goal) => goal.id === "deliver2",
            )?.done,
          ).toBe(true);
          expect(
            await client.query.userItem.findMany({
              where: eq(userItem.userId, "helper"),
            }),
          ).toHaveLength(0);
          // A replacement after both deliveries inherits receipts without receiving retired copies.
          await insertUsers([questTeamMember("late")]);
          expect(
            (
              await (
                await callerFor(questPartyRouter, "late")
              ).join({ partyId: party.id })
            ).success,
          ).toBe(true);
          for (let read = 0; read < 2; read++) {
            await fetchUpdatedUser({ client, userId: "late" });
            expect(
              await client.query.userItem.findMany({
                where: eq(userItem.userId, "late"),
              }),
            ).toHaveLength(0);
          }
          const late = (await client.query.userData.findFirst({
            where: eq(userData.userId, "late"),
          }))!;
          expect(
            late.questData
              ?.find((tracker) => tracker.id === "team-quest")
              ?.goals.filter((goal) =>
                ["collect1", "collect2", "deliver1", "deliver2"].includes(goal.id),
              )
              .every((goal) => goal.partyEffectsApplied),
          ).toBe(true);
        });
      }
    }

    for (const consecutiveObjectives of [false, true]) {
      for (const refreshed of [false, true]) {
        it(`retains one copy after two shared collections and one delivery (${consecutiveObjectives ? "consecutive" : "parallel"}, ${refreshed ? "first receipt applied" : "unrefreshed"})`, async () => {
          const client = await getTestDatabase();
          await insertItems([{ id: "scroll" }]);
          const objectives = [
            AllObjectives.parse({
              id: "second",
              task: "collect_item",
              collectItemIds: ["scroll"],
              item_name: "Scroll",
              sector: 50,
              longitude: 13,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "delivery",
            }),
            AllObjectives.parse({
              id: "delivery",
              task: "deliver_item",
              deliverItemIds: ["scroll"],
              item_name: "Scroll",
              sector: 50,
              longitude: 14,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "wait",
            }),
            AllObjectives.parse({
              id: "first",
              task: "collect_item",
              collectItemIds: ["scroll"],
              item_name: "Scroll",
              sector: 50,
              longitude: 11,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "second",
            }),
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ];
          expect(
            verifyQuestContentForSave(objectives, consecutiveObjectives).check,
          ).toBe(true);
          await insertTeamQuest(objectives, {
            consecutiveObjectives,
            maxAttempts: 3,
            maxCompletes: 3,
          });
          expect(
            QuestValidator.safeParse(await client.query.quest.findFirst()).success,
          ).toBe(true);
          const leader = await callerFor(questPartyRouter, "leader");
          expect(
            (await leader.create({ questId: "team-quest", isPublic: true })).success,
          ).toBe(true);
          const party = (await client.query.questParty.findFirst())!;
          expect(
            (
              await (
                await callerFor(questPartyRouter, "helper")
              ).join({ partyId: party.id })
            ).success,
          ).toBe(true);
          const leaderQuest = await callerFor(questsRouter, "leader");
          await client
            .update(userData)
            .set({ longitude: 11 })
            .where(eq(userData.userId, "leader"));
          expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
          if (refreshed) await fetchUpdatedUser({ client, userId: "helper" });
          const firstCopies = await client.query.userItem.findMany({
            where: eq(userItem.userId, "helper"),
          });
          expect(firstCopies).toHaveLength(refreshed ? 1 : 0);
          await client
            .update(userData)
            .set({ longitude: 13 })
            .where(eq(userData.userId, "leader"));
          expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
          expect(
            await client.query.userItem.findMany({
              where: eq(userItem.userId, "leader"),
            }),
          ).toHaveLength(2);
          await client
            .update(userData)
            .set({ longitude: 14 })
            .where(eq(userData.userId, "leader"));
          expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
          expect(
            await client.query.userItem.findMany({
              where: eq(userItem.userId, "leader"),
            }),
          ).toHaveLength(1);
          expect((await leader.leave({ partyId: party.id })).success).toBe(true);
          await fetchUpdatedUser({ client, userId: "helper" });
          const copies = await client.query.userItem.findMany({
            where: eq(userItem.userId, "helper"),
          });
          expect(copies).toHaveLength(1);
          expect(copies[0]).toMatchObject({ itemId: "scroll", quantity: 1 });
          if (refreshed) expect(copies[0]?.id).not.toBe(firstCopies[0]?.id);
          await fetchUpdatedUser({ client, userId: "helper" });
          expect(
            await client.query.userItem.findMany({
              where: eq(userItem.userId, "helper"),
            }),
          ).toEqual(copies);
          const personal = (await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          }))!;
          expect(
            personal.questData
              ?.find((tracker) => tracker.id === "team-quest")
              ?.goals.filter((goal) =>
                ["first", "second", "delivery"].includes(goal.id),
              )
              .every((goal) => goal.done && goal.partyEffectsApplied),
          ).toBe(true);
        });
      }
    }

    for (const consecutiveObjectives of [true, false]) {
      for (const mode of [
        "missed deliveries",
        "disbanded",
        "equipped copy",
        "distinct items",
        "refresh each delivery",
      ] as const) {
        it(`retires each shared delivery copy (${consecutiveObjectives ? "consecutive" : "parallel"}, ${mode})`, async () => {
          const client = await getTestDatabase();
          await insertItems([{ id: "scroll" }, { id: "second-scroll" }]);
          const secondId = mode === "distinct items" ? "second-scroll" : "scroll";
          const location = {
            item_name: "Scroll",
            sector: 50,
            latitude: 10,
            sectorType: "specific",
            locationType: "specific",
          };
          const objectives = [
            AllObjectives.parse({
              ...location,
              id: "collect1",
              task: "collect_item",
              collectItemIds: ["scroll"],
              longitude: 11,
              nextObjectiveId: "collect2",
            }),
            AllObjectives.parse({
              ...location,
              id: "collect2",
              task: "collect_item",
              collectItemIds: [secondId],
              longitude: 13,
              nextObjectiveId: "deliver1",
            }),
            AllObjectives.parse({
              ...location,
              id: "deliver1",
              task: "deliver_item",
              deliverItemIds: ["scroll"],
              longitude: 14,
              nextObjectiveId: "deliver2",
            }),
            AllObjectives.parse({
              ...location,
              id: "deliver2",
              task: "deliver_item",
              deliverItemIds: [secondId],
              longitude: 15,
              nextObjectiveId: "wait",
            }),
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ];
          expect(
            verifyQuestContentForSave(objectives, consecutiveObjectives).check,
          ).toBe(true);
          await insertTeamQuest(objectives, {
            consecutiveObjectives,
            maxAttempts: 3,
            maxCompletes: 3,
          });
          expect(
            QuestValidator.safeParse(await client.query.quest.findFirst()).success,
          ).toBe(true);
          const leader = await callerFor(questPartyRouter, "leader");
          expect(
            (await leader.create({ questId: "team-quest", isPublic: true })).success,
          ).toBe(true);
          const party = (await client.query.questParty.findFirst())!;
          expect(
            (
              await (
                await callerFor(questPartyRouter, "helper")
              ).join({ partyId: party.id })
            ).success,
          ).toBe(true);
          const leaderQuest = await callerFor(questsRouter, "leader");
          for (const longitude of [11, 13]) {
            await client
              .update(userData)
              .set({ longitude })
              .where(eq(userData.userId, "leader"));
            expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
          }
          await fetchUpdatedUser({ client, userId: "helper" });
          const copies = await client.query.userItem.findMany({
            where: eq(userItem.userId, "helper"),
          });
          expect(copies).toHaveLength(2);
          if (mode === "equipped copy")
            await client
              .update(userItem)
              .set({ equipped: "CHEST" })
              .where(eq(userItem.id, copies[0]!.id));
          for (const longitude of [14, 15]) {
            await client
              .update(userData)
              .set({ longitude })
              .where(eq(userData.userId, "leader"));
            expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
            if (mode === "refresh each delivery")
              await fetchUpdatedUser({ client, userId: "helper" });
          }
          expect(
            await client.query.userItem.findMany({
              where: eq(userItem.userId, "leader"),
            }),
          ).toHaveLength(0);
          if (mode === "disbanded")
            expect((await leader.disband({ partyId: party.id })).success).toBe(true);
          for (let read = 0; read < 2; read++) {
            await fetchUpdatedUser({ client, userId: "helper" });
            expect(
              await client.query.userItem.findMany({
                where: eq(userItem.userId, "helper"),
              }),
            ).toHaveLength(0);
          }
          const personal = (await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          }))!;
          expect(
            personal.questData
              ?.find((tracker) => tracker.id === "team-quest")
              ?.goals.filter((goal) =>
                ["collect1", "collect2", "deliver1", "deliver2"].includes(goal.id),
              )
              .every((goal) => goal.done && goal.partyEffectsApplied),
          ).toBe(true);
        });
      }
    }

    for (const consecutiveObjectives of [true, false]) {
      for (const mode of [
        "refresh each",
        "missed polls",
        "replacement",
        "disbanded",
        "distinct spare",
        "standalone delivery",
      ] as const) {
        it(`preserves prior inventory when a shared collection and delivery reconcile together (${consecutiveObjectives ? "consecutive" : "parallel"}, ${mode})`, async () => {
          const client = await getTestDatabase();
          await insertItems([{ id: "scroll" }, { id: "spare" }]);
          await insertUserItems([
            {
              id: "preexisting-copy",
              userId: "helper",
              itemId: mode === "distinct spare" ? "spare" : "scroll",
            },
          ]);
          const location = {
            item_name: "Scroll",
            sector: 50,
            latitude: 10,
            sectorType: "specific",
            locationType: "specific",
          };
          let objectives = [
            AllObjectives.parse({
              ...location,
              id: "collect",
              task: "collect_item",
              collectItemIds: ["scroll"],
              longitude: 11,
              nextObjectiveId: "deliver",
            }),
            AllObjectives.parse({
              ...location,
              id: "deliver",
              task: "deliver_item",
              deliverItemIds: ["scroll"],
              longitude: 12,
              nextObjectiveId: "wait",
            }),
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ];
          if (mode === "standalone delivery") {
            objectives = objectives.filter((objective) => objective.id !== "collect");
            await insertUserItems([
              { id: "leader-delivery", userId: "leader", itemId: "scroll" },
            ]);
          }
          expect(
            verifyQuestContentForSave(objectives, consecutiveObjectives).check,
          ).toBe(true);
          await insertTeamQuest(objectives, {
            consecutiveObjectives,
            maxAttempts: 3,
            maxCompletes: 3,
          });
          expect(
            QuestValidator.safeParse(await client.query.quest.findFirst()).success,
          ).toBe(true);
          const leader = await callerFor(questPartyRouter, "leader");
          const helper = await callerFor(questPartyRouter, "helper");
          expect(
            (await leader.create({ questId: "team-quest", isPublic: true })).success,
          ).toBe(true);
          const party = (await client.query.questParty.findFirst())!;
          if (mode !== "replacement")
            expect((await helper.join({ partyId: party.id })).success).toBe(true);
          const leaderQuest = await callerFor(questsRouter, "leader");
          for (const longitude of mode === "standalone delivery" ? [12] : [11, 12]) {
            await client
              .update(userData)
              .set({ longitude })
              .where(eq(userData.userId, "leader"));
            expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
            if (mode === "refresh each")
              await fetchUpdatedUser({ client, userId: "helper" });
          }
          if (mode === "replacement")
            expect((await helper.join({ partyId: party.id })).success).toBe(true);
          if (mode === "disbanded")
            expect((await leader.disband({ partyId: party.id })).success).toBe(true);
          for (let read = 0; read < 2; read++) {
            await fetchUpdatedUser({ client, userId: "helper" });
            const copies = await client.query.userItem.findMany({
              where: eq(userItem.userId, "helper"),
            });
            expect(copies).toHaveLength(mode === "standalone delivery" ? 0 : 1);
            if (copies.length > 0) {
              expect(copies[0]).toMatchObject({
                itemId: mode === "distinct spare" ? "spare" : "scroll",
                quantity: 1,
              });
              if (mode !== "refresh each")
                expect(copies[0]?.id).toBe("preexisting-copy");
            }
          }
          const personal = (await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          }))!;
          expect(
            personal.questData
              ?.find((tracker) => tracker.id === "team-quest")
              ?.goals.filter((goal) => ["collect", "deliver"].includes(goal.id))
              .every((goal) => goal.done && goal.partyEffectsApplied),
          ).toBe(true);
        });
      }
    }

    it("matches applied parallel deliveries before a later pending pair in reordered definitions", async () => {
      const client = await getTestDatabase();
      await insertItems([{ id: "scroll" }]);
      await insertUserItems([
        { id: "preexisting-copy", userId: "helper", itemId: "scroll" },
      ]);
      const location = {
        item_name: "Scroll",
        sector: 50,
        latitude: 10,
        sectorType: "specific",
        locationType: "specific",
      };
      const objectives = [
        AllObjectives.parse({
          ...location,
          id: "collect1",
          task: "collect_item",
          collectItemIds: ["scroll"],
          longitude: 11,
          nextObjectiveId: "deliver1",
        }),
        AllObjectives.parse({
          ...location,
          id: "collect2",
          task: "collect_item",
          collectItemIds: ["scroll"],
          longitude: 13,
          nextObjectiveId: "deliver2",
        }),
        AllObjectives.parse({
          ...location,
          id: "deliver2",
          task: "deliver_item",
          deliverItemIds: ["scroll"],
          longitude: 14,
          nextObjectiveId: "wait",
        }),
        AllObjectives.parse({
          ...location,
          id: "deliver1",
          task: "deliver_item",
          deliverItemIds: ["scroll"],
          longitude: 12,
          nextObjectiveId: "collect2",
        }),
        AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
      ];
      expect(verifyQuestContentForSave(objectives, false).check).toBe(true);
      await insertTeamQuest(objectives, {
        consecutiveObjectives: false,
        maxAttempts: 3,
        maxCompletes: 3,
      });
      expect(
        QuestValidator.safeParse(await client.query.quest.findFirst()).success,
      ).toBe(true);
      const leader = await callerFor(questPartyRouter, "leader");
      expect(
        (await leader.create({ questId: "team-quest", isPublic: true })).success,
      ).toBe(true);
      const party = (await client.query.questParty.findFirst())!;
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).join({ partyId: party.id })
        ).success,
      ).toBe(true);
      const leaderQuest = await callerFor(questsRouter, "leader");
      for (const longitude of [11, 12, 13, 14]) {
        await client
          .update(userData)
          .set({ longitude })
          .where(eq(userData.userId, "leader"));
        expect((await leaderQuest.checkLocationQuest()).success).toBe(true);
        if (longitude <= 12) await fetchUpdatedUser({ client, userId: "helper" });
      }
      for (let read = 0; read < 2; read++) {
        await fetchUpdatedUser({ client, userId: "helper" });
        expect(
          await client.query.userItem.findMany({
            where: eq(userItem.userId, "helper"),
          }),
        ).toMatchObject([{ itemId: "scroll", quantity: 1 }]);
      }
      const personal = (await client.query.userData.findFirst({
        where: eq(userData.userId, "helper"),
      }))!;
      expect(
        personal.questData
          ?.find((tracker) => tracker.id === "team-quest")
          ?.goals.filter((goal) =>
            ["collect1", "collect2", "deliver1", "deliver2"].includes(goal.id),
          )
          .every((goal) => goal.done && goal.partyEffectsApplied),
      ).toBe(true);
    });

    it("takes one unit for duplicate IDs within an ordinary delivery, backpack first", async () => {
      const client = await getTestDatabase();
      await insertItems([{ id: "scroll" }]);
      await insertUserItems([
        {
          id: "stack",
          userId: "helper",
          itemId: "scroll",
          quantity: 3,
          equipped: "CHEST",
        },
        { id: "spare", userId: "helper", itemId: "scroll" },
      ]);
      const { user } = await fetchUpdatedUser({ client, userId: "helper" });
      expect(user?.questPartyId).toBeNull();
      expect(
        (
          await handleQuestConsequences(
            client,
            user!,
            [{ type: "remove_item", ids: ["scroll", "scroll"] }],
            [],
          )
        ).claimed,
      ).toBe(true);
      expect(
        await client.query.userItem.findMany({
          where: eq(userItem.userId, "helper"),
          orderBy: asc(userItem.id),
        }),
      ).toMatchObject([{ id: "stack", quantity: 3 }]);
    });

    it("allocates separate delivery rows without consuming unavailable inventory", async () => {
      const client = await getTestDatabase();
      await insertItems([{ id: "scroll" }]);
      await insertUserItems([
        { id: "copy1", userId: "helper", itemId: "scroll" },
        { id: "copy2", userId: "helper", itemId: "scroll" },
        { id: "home", userId: "helper", itemId: "scroll", storedAtHome: true },
        { id: "auction", userId: "helper", itemId: "scroll", isInAuction: true },
        {
          id: "crafting",
          userId: "helper",
          itemId: "scroll",
          craftingFinishedAt: new Date(Date.now() + 60_000),
        },
        { id: "merge", userId: "helper", itemId: "scroll", quantity: -1 },
        { id: "empty", userId: "helper", itemId: "scroll", quantity: 0 },
      ]);
      const { user } = await fetchUpdatedUser({ client, userId: "helper" });
      expect(
        (
          await handleQuestConsequences(
            client,
            user!,
            [
              { type: "remove_item", ids: ["scroll", "scroll"] },
              { type: "remove_item", ids: ["scroll"] },
            ],
            [],
          )
        ).claimed,
      ).toBe(true);
      expect(
        (await client.query.userItem.findMany({ where: eq(userItem.userId, "helper") }))
          .map((copy) => copy.id)
          .sort(),
      ).toEqual(["auction", "crafting", "empty", "home", "merge"]);
    });

    for (const mode of ["form", "join", "replacement"] as const) {
      it(`preserves collection deliveries when entering a team (${mode})`, async () => {
        const client = await getTestDatabase();
        await insertItems([{ id: "scroll" }]);
        await insertTeamQuest(
          [
            AllObjectives.parse({
              id: "collect",
              task: "collect_item",
              collectItemIds: ["scroll"],
              item_name: "Scroll",
              sector: 50,
              longitude: 11,
              latitude: 10,
              sectorType: "specific",
              locationType: "specific",
              nextObjectiveId: "wait",
            }),
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ],
          { consecutiveObjectives: true, maxAttempts: 3, maxCompletes: 3 },
        );
        const leader = await callerFor(questPartyRouter, "leader");
        if (mode !== "form") {
          expect(
            (await leader.create({ questId: "team-quest", isPublic: true })).success,
          ).toBe(true);
          await client
            .update(userData)
            .set({ longitude: 11 })
            .where(eq(userData.userId, "leader"));
          await (await callerFor(questsRouter, "leader")).checkLocationQuest();
        }
        const userId = mode === "form" ? "leader" : "helper";
        const personal = await callerFor(questsRouter, userId);
        if (mode !== "replacement") {
          expect(
            (await personal.startQuest({ questId: "team-quest", userSector: 50 }))
              .success,
          ).toBe(true);
          await client
            .update(userData)
            .set({ longitude: 11 })
            .where(eq(userData.userId, userId));
          await personal.checkLocationQuest();
          const solo = await client.query.userData.findFirst({
            where: eq(userData.userId, userId),
          });
          const tracker = solo?.questData?.find((entry) => entry.id === "team-quest");
          expect(tracker?.party).toBeUndefined();
          expect(tracker?.goals.find((goal) => goal.id === "collect")).toMatchObject({
            done: true,
          });
          expect(
            tracker?.goals.find((goal) => goal.id === "collect")?.partyEffectsApplied,
          ).toBeUndefined();
        }
        const before = await client.query.userItem.findMany({
          where: eq(userItem.userId, userId),
        });
        expect(before).toHaveLength(mode === "replacement" ? 0 : 1);
        if (mode === "form") {
          expect(
            (await leader.create({ questId: "team-quest", isPublic: true })).success,
          ).toBe(true);
        } else {
          const party = await client.query.questParty.findFirst();
          if (!party) throw new Error("Missing collection team fixture");
          expect(
            (
              await (
                await callerFor(questPartyRouter, userId)
              ).join({ partyId: party.id })
            ).success,
          ).toBe(true);
        }
        const profile = await callerFor(profileRouter, userId);
        for (let read = 0; read < 2; read++) {
          await profile.getUser();
          const items = await client.query.userItem.findMany({
            where: eq(userItem.userId, userId),
          });
          expect(items).toHaveLength(1);
          expect(items[0]).toMatchObject({ itemId: "scroll", quantity: 1 });
          if (mode !== "replacement") expect(items).toEqual(before);
        }
        const receipt = await client.query.questHistory.findFirst({
          where: eq(questHistory.userId, userId),
        });
        expect(receipt).toMatchObject({
          previousAttempts: 1,
          completed: 0,
          endAt: null,
        });
        const saved = await client.query.userData.findFirst({
          where: eq(userData.userId, userId),
        });
        expect(
          saved?.questData
            ?.find((entry) => entry.id === "team-quest")
            ?.goals.find((goal) => goal.id === "collect")?.partyEffectsApplied,
        ).toBe(true);
        if (mode !== "form") {
          await (await callerFor(profileRouter, "leader")).getUser();
          expect(
            await client.query.userItem.findMany({
              where: eq(userItem.userId, "leader"),
            }),
          ).toHaveLength(1);
        }
      });
    }

    it("explains rank rejection to completed helpers and releases membership for a later retry", async () => {
      const client = await getTestDatabase();
      await client
        .update(userData)
        .set({ rank: "GENIN" })
        .where(eq(userData.userId, "helper"));
      await insertTeamQuest(
        [AllObjectives.parse({ id: "goal", task: "stats_trained", value: 100 })],
        { questRank: "C", maxAttempts: 3, maxCompletes: 3 },
      );
      const endAt = new Date("2026-10-01T00:00:00Z");
      await insertQuestHistory([
        {
          id: "receipt",
          userId: "helper",
          questId: "team-quest",
          questType: "event",
          completed: 1,
          previousCompletes: 1,
          previousAttempts: 1,
          endAt,
        },
      ]);
      const receipt = await client.query.questHistory.findFirst({
        where: eq(questHistory.id, "receipt"),
      });
      // Content changes can make a formerly completed quest exceed a helper's rank.
      await client
        .update(quest)
        .set({ questRank: "A" })
        .where(eq(quest.id, "team-quest"));
      const leader = await callerFor(questPartyRouter, "leader");
      const helper = await callerFor(questPartyRouter, "helper");
      expect(
        (await leader.create({ questId: "team-quest", isPublic: true })).success,
      ).toBe(true);
      const party = (await client.query.questParty.findFirst())!;
      expect(await helper.join({ partyId: party.id })).toEqual({
        success: false,
        message: "Rank GENIN not allowed",
      });
      expect(
        await client.query.questHistory.findFirst({
          where: eq(questHistory.id, "receipt"),
        }),
      ).toEqual(receipt);
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          })
        )?.questPartyId,
      ).toBeNull();
      expect(await client.query.questParty.findFirst()).toMatchObject({
        memberIds: ["leader"],
        battleId: null,
      });
      expect(
        await client.query.user2conversation.findFirst({
          where: eq(user2conversation.userId, "helper"),
        }),
      ).toBeUndefined();
      await client
        .update(quest)
        .set({ questRank: "C" })
        .where(eq(quest.id, "team-quest"));
      expect((await helper.join({ partyId: party.id })).success).toBe(true);
      expect(
        await client.query.questHistory.findFirst({
          where: eq(questHistory.id, "receipt"),
        }),
      ).toEqual(
        expect.objectContaining({
          completed: 1,
          previousCompletes: 1,
          previousAttempts: 2,
          endAt,
        }),
      );
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          })
        )?.questPartyId,
      ).toBe(party.id);
    });

    it("keeps lifetime-completed helpers active across profile reads and encounter preload without reopening or paying their receipt", async () => {
      const client = await getTestDatabase();
      await insertUsers([
        { userId: "enemy", username: "enemy", isAi: true, level: 10, rank: "GENIN" },
      ]);
      await insertDefaultAiProfile({ userId: "enemy" });
      await insertQuests([
        {
          id: "team-quest",
          questType: "event",
          teamEnabled: true,
          hidden: false,
          maxAttempts: 2,
          maxCompletes: 2,
          retryDelay: "none",
          content: {
            objectives: [
              AllObjectives.parse({
                id: "goal",
                task: "start_battle",
                opponentAIs: [{ ids: ["enemy"], number: 1 }],
              }),
            ],
            reward: ObjectiveReward.parse({ reward_money: 100 }),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      const endAt = new Date("2026-10-01T00:00:00Z");
      await insertQuestHistory([
        {
          id: "receipt",
          userId: "helper",
          questId: "team-quest",
          questType: "event",
          completed: 0,
          previousCompletes: 1,
          previousAttempts: 1,
          endAt,
        },
      ]);
      const leader = await callerFor(questPartyRouter, "leader");
      expect(
        (await leader.create({ questId: "team-quest", isPublic: true })).success,
      ).toBe(true);
      const party = await client.query.questParty.findFirst();
      if (!party) throw new Error("Missing team fixture");
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).join({ partyId: party.id })
        ).success,
      ).toBe(true);
      const fresh = await fetchUpdatedUser({ client, userId: "helper" });
      expect(
        fresh.user?.userQuests.find((entry) => entry.questId === "team-quest")?.id,
      ).toBe(`party-${party.id}`);
      expect(
        fresh.user?.questData?.find((entry) => entry.id === "team-quest")?.party?.id,
      ).toBe(party.id);
      expect((await leader.startEncounter({ partyId: party.id })).success).toBe(true);
      const savedBattle = await client.query.battle.findFirst();
      if (!savedBattle) throw new Error("Missing battle fixture");
      expect(
        savedBattle.extraState.userQuests.helper?.find(
          (entry) => entry.questId === "team-quest",
        )?.id,
      ).toBe(`party-${party.id}`);
      expect(
        savedBattle.extraState.questData.helper?.find(
          (entry) => entry.id === "team-quest",
        )?.party?.id,
      ).toBe(party.id);
      const finishedTracker = structuredClone(party.tracker);
      finishedTracker.goals.forEach((goal) => {
        goal.done = true;
      });
      await client
        .update(questParty)
        .set({ tracker: finishedTracker, version: party.version + 1 })
        .where(eq(questParty.id, party.id));
      await client
        .update(userData)
        .set({ status: "AWAKE", battleId: null })
        .where(eq(userData.userId, "helper"));
      const claimed = await (await callerFor(questsRouter, "helper")).checkRewards({
        questId: "team-quest",
      });
      expect(claimed.success).toBe(true);
      const receipt = await client.query.questHistory.findFirst({
        where: eq(questHistory.id, "receipt"),
      });
      expect(receipt).toEqual(
        expect.objectContaining({
          completed: 0,
          previousCompletes: 1,
          previousAttempts: 2,
          endAt,
        }),
      );
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          })
        )?.money,
      ).toBe(100);
    });

    it("fails every member when a bound NPC was deleted without a failure branch and denies final rewards", async () => {
      const client = await getTestDatabase();
      await insertQuests([
        {
          id: "team-quest",
          questType: "event",
          teamEnabled: true,
          hidden: false,
          maxAttempts: 2,
          retryDelay: "none",
          content: {
            objectives: [
              AllObjectives.parse({
                id: "goal",
                task: "defeat_opponents",
                overworldPlacementId: "deleted-placement",
                opponentAIs: [{ ids: ["enemy"], number: 1 }],
                sector: 50,
                longitude: 10,
                latitude: 10,
              }),
            ],
            reward: ObjectiveReward.parse({ reward_money: 100 }),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      expect(
        (
          await (
            await callerFor(questPartyRouter, "leader")
          ).create({ questId: "team-quest", isPublic: true })
        ).success,
      ).toBe(true);
      const party = await client.query.questParty.findFirst();
      if (!party) throw new Error("Missing team fixture");
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).join({ partyId: party.id })
        ).success,
      ).toBe(true);
      const location = await (
        await callerFor(questsRouter, "leader")
      ).checkLocationQuest();
      expect(
        location.notifications?.some((message) =>
          message.includes("destination was removed"),
        ),
      ).toBe(true);
      expect(
        (
          await client.query.questParty.findFirst({
            where: eq(questParty.id, party.id),
          })
        )?.tracker.failed,
      ).toBe(true);
      const overview = await (await callerFor(questPartyRouter, "leader")).overview();
      expect(overview.current).toMatchObject({ failed: true, completed: false });
      expect(overview.teams).toHaveLength(0);
      const teammate = await fetchUpdatedUser({ client, userId: "helper" });
      expect(
        teammate.user?.questData?.find((entry) => entry.id === "team-quest")?.failed,
      ).toBe(true);
      const claim = await (await callerFor(questsRouter, "helper")).checkRewards({
        questId: "team-quest",
      });
      expect(claim.rewards?.reward_money).toBe(0);
      const histories = await client.query.questHistory.findMany({
        where: eq(questHistory.questId, "team-quest"),
      });
      expect(histories).toHaveLength(2);
      expect(
        histories.every((entry) => entry.completed === 0 && entry.endAt !== null),
      ).toBe(true);
      expect(
        (
          await client.query.userData.findMany({
            where: eq(userData.villageId, "home"),
          })
        ).map((entry) => entry.money),
      ).toEqual([100, 100]);
    });

    it("reports a successful team completion and pays the eligible member", async () => {
      await insertQuests([
        {
          id: "team-quest",
          questType: "event",
          teamEnabled: true,
          hidden: false,
          retryDelay: "none",
          content: {
            objectives: [
              AllObjectives.parse({ id: "goal", task: "stats_trained", value: 1 }),
            ],
            reward: ObjectiveReward.parse({ reward_money: 100 }),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      const leader = await callerFor(questPartyRouter, "leader");
      expect(
        (await leader.create({ questId: "team-quest", isPublic: true })).success,
      ).toBe(true);
      const client = await getTestDatabase();
      const { user } = await fetchUpdatedUser({ client, userId: "leader" });
      if (!user) throw new Error("Missing completed team fixture");
      user.questData = getNewTrackers(user, [
        { task: "stats_trained", increment: 1 },
      ]).trackers;
      const claim = await commitQuestObjectiveRewards({
        client,
        userId: "leader",
        user,
        ...getReward(user, "team-quest"),
      });
      expect(claim.outcome).toBe("claimed");
      const overview = await leader.overview();
      expect(overview.current).toMatchObject({ failed: false, completed: true });
      expect(overview.teams).toHaveLength(0);
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "leader"),
          })
        )?.money,
      ).toBe(200);
    });

    for (const mode of ["bound-other-tile", "bound-same-tile", "generic"] as const) {
      it(`starts the selected eligible combat objective (${mode})`, async () => {
        const client = await getTestDatabase();
        await insertUsers(
          ["enemy-first", "enemy-selected"].map((userId) => ({
            userId,
            username: userId,
            isAi: true,
            level: 10,
            rank: "GENIN",
          })),
        );
        await insertDefaultAiProfile({ userId: "enemy-selected" });
        if (mode !== "generic") {
          await client.insert(overworldAiPlacement).values({
            id: "selected-npc",
            aiTemplateUserId: "enemy-selected",
            interactionType: "HOSTILE",
            sectorList: [],
            sector: 50,
            longitude: 10,
            latitude: 10,
            positionVersion: 0,
          });
        }
        await insertTeamQuest(
          [
            AllObjectives.parse({
              id: "first",
              task: "defeat_opponents",
              opponentAIs: [{ ids: ["enemy-first"], number: 1 }],
              sector: 50,
              longitude: mode === "bound-same-tile" ? 10 : 5,
              latitude: 10,
            }),
            AllObjectives.parse({
              id: "selected",
              task: "defeat_opponents",
              overworldPlacementId: mode === "generic" ? undefined : "selected-npc",
              opponentAIs: [{ ids: ["enemy-selected"], number: 1 }],
              sector: 50,
              longitude: 10,
              latitude: 10,
            }),
          ],
          { consecutiveObjectives: false, maxAttempts: 2 },
        );
        const leader = await callerFor(questPartyRouter, "leader");
        expect(
          (await leader.create({ questId: "team-quest", isPublic: true })).success,
        ).toBe(true);
        const party = await client.query.questParty.findFirst();
        if (!party) throw new Error("Missing team fixture");
        const result =
          mode === "generic"
            ? await leader.startEncounter({ partyId: party.id })
            : await (
                await callerFor(overworldAiRouter, "leader")
              ).interactWithOverworldAi({
                placementId: "selected-npc",
                positionVersion: 0,
              });
        expect(result.success).toBe(true);
        const savedBattle = await client.query.battle.findFirst();
        expect(
          savedBattle?.usersState.some(
            (entry) => entry.controllerId === "enemy-selected",
          ),
        ).toBe(true);
        expect(
          savedBattle?.usersState.some((entry) => entry.controllerId === "enemy-first"),
        ).toBe(false);
      });
    }

    it("rejects nonleader overworld dialog before returning branches", async () => {
      const client = await getTestDatabase();
      await insertUsers([{ userId: "guide", username: "guide", isAi: true }]);
      await client.insert(overworldAiPlacement).values({
        id: "guide-npc",
        aiTemplateUserId: "guide",
        interactionType: "FRIENDLY",
        sectorList: [],
        sector: 50,
        longitude: 10,
        latitude: 10,
        positionVersion: 0,
      });
      await insertTeamQuest([
        AllObjectives.parse({
          id: "choice",
          task: "dialog",
          overworldPlacementId: "guide-npc",
          nextObjectiveId: [{ text: "Continue", nextObjectiveId: "goal" }],
        }),
        AllObjectives.parse({ id: "goal", task: "stats_trained", value: 10 }),
      ]);
      expect(
        (
          await (
            await callerFor(questPartyRouter, "leader")
          ).create({ questId: "team-quest", isPublic: true })
        ).success,
      ).toBe(true);
      const party = (await client.query.questParty.findFirst())!;
      expect(
        (
          await (
            await callerFor(questPartyRouter, "helper")
          ).join({ partyId: party.id })
        ).success,
      ).toBe(true);
      const input = { placementId: "guide-npc", positionVersion: 0 };
      const member = await callerFor(overworldAiRouter, "helper");
      for (const dialogContentId of [undefined, "goal"]) {
        const result = await member.interactWithOverworldAi({
          ...input,
          dialogContentId,
        });
        expect(result.success).toBe(false);
        expect(result.message).toBe("The quest team leader chooses dialog branches");
        expect(result.dialog).toBeUndefined();
      }
      expect(
        (
          await (
            await callerFor(overworldAiRouter, "leader")
          ).interactWithOverworldAi(input)
        ).dialog?.branches,
      ).toHaveLength(1);
    });

    for (const failure of ["CAS misses", "database error"] as const) {
      it(`finishes a claimed reward after a shared reset ${failure}`, async () => {
        const client = await getTestDatabase();
        const reported = vi
          .spyOn(Sentry, "captureException")
          .mockReturnValue("reported");
        await insertQuests([
          {
            id: "team-quest",
            questType: "event",
            teamEnabled: true,
            hidden: false,
            consecutiveObjectives: false,
            retryDelay: "none",
            content: {
              objectives: [
                AllObjectives.parse({ id: "goal", task: "stats_trained", value: 10 }),
                AllObjectives.parse({
                  id: "pending",
                  task: "stats_trained",
                  value: 1000,
                }),
              ],
              reward: ObjectiveReward.parse({ reward_money: 100 }),
              sceneBackground: "",
              sceneCharacters: [],
            },
          },
        ]);
        expect(
          (
            await (
              await callerFor(questPartyRouter, "leader")
            ).create({ questId: "team-quest", isPublic: true })
          ).success,
        ).toBe(true);
        const { user } = await fetchUpdatedUser({ client, userId: "leader" });
        if (!user) throw new Error("Missing reset fixture");
        user.questData = getNewTrackers(user, [
          { task: "stats_trained", increment: 1000 },
        ]).trackers;
        const reward = getReward(user, "team-quest");
        expect(reward.resolved).toBe(true);
        reward.consequences.push({
          type: "reset_quest",
          ids: ["team-quest"],
          info: "pending",
        });
        const injected = failPartyWrites(client, failure);
        const result = await commitQuestObjectiveRewards({
          client: injected.client,
          userId: "leader",
          user,
          ...reward,
        });
        expect(result.outcome).toBe("claimed");
        expect(result).toMatchObject({
          postNotifications: expect.arrayContaining([
            "Quest team progress will update on your next request.",
          ]),
        });
        expect(injected.failedWrites()).toBe(failure === "CAS misses" ? 5 : 1);
        expect(reported).toHaveBeenCalledTimes(1);
        expect(
          (
            await client.query.userData.findFirst({
              where: eq(userData.userId, "leader"),
            })
          )?.money,
        ).toBe(200);
        expect(
          (
            await client.query.questHistory.findFirst({
              where: eq(questHistory.questId, "team-quest"),
            })
          )?.completed,
        ).toBe(1);
        expect(
          (
            await commitQuestObjectiveRewards({
              client,
              userId: "leader",
              user,
              ...reward,
            })
          ).outcome,
        ).toBe("already_completed");
        expect(
          (
            await client.query.userData.findFirst({
              where: eq(userData.userId, "leader"),
            })
          )?.money,
        ).toBe(200);
      });

      it(`finishes a claimed payout and consequences and recovers terminal progress after party publication ${failure}`, async () => {
        const client = await getTestDatabase();
        const reported = vi
          .spyOn(Sentry, "captureException")
          .mockReturnValue("reported");
        vi.spyOn(Math, "random").mockReturnValue(0);
        await insertItems([{ id: "herb", canBeGathered: true }]);
        await client
          .update(userData)
          .set({ occupation: "GATHERING" })
          .where(eq(userData.userId, "leader"));
        await insertQuests([
          {
            id: "next-quest",
            questType: "event",
            hidden: false,
            maxAttempts: 3,
            maxCompletes: 3,
            retryDelay: "none",
          },
          {
            id: "team-quest",
            questType: "event",
            teamEnabled: true,
            hidden: false,
            consecutiveObjectives: false,
            maxAttempts: 3,
            maxCompletes: 3,
            retryDelay: "none",
            content: {
              objectives: [
                AllObjectives.parse({
                  id: "goal",
                  task: "stats_trained",
                  value: 10,
                  reward_money: 25,
                }),
              ],
              reward: ObjectiveReward.parse({
                reward_money: 100,
                reward_gathering_items: true,
              }),
              sceneBackground: "",
              sceneCharacters: [],
            },
          },
        ]);
        expect(
          (
            await (
              await callerFor(questPartyRouter, "leader")
            ).create({ questId: "team-quest", isPublic: true })
          ).success,
        ).toBe(true);
        const { user } = await fetchUpdatedUser({ client, userId: "leader" });
        if (!user) throw new Error("Missing leader fixture");
        user.questData = getNewTrackers(user, [
          { task: "stats_trained", increment: 10 },
        ]).trackers;
        const reward = getReward(user, "team-quest");
        expect(reward.resolved).toBe(true);
        reward.consequences.push({ type: "start_quest", ids: ["next-quest"] });
        const injected = failPartyWrites(client, failure);
        const result = await commitQuestObjectiveRewards({
          client: injected.client,
          userId: "leader",
          user,
          ...reward,
        });
        expect(result.outcome).toBe("claimed");
        expect(injected.failedWrites()).toBe(failure === "CAS misses" ? 5 : 1);
        expect(reported).toHaveBeenCalledTimes(1);
        const receipt = await client.query.questHistory.findFirst({
          where: eq(questHistory.questId, "team-quest"),
        });
        expect(receipt).toMatchObject({ completed: 1, previousCompletes: 1 });
        expect(receipt?.endAt).not.toBeNull();
        const saved = await client.query.userData.findFirst({
          where: eq(userData.userId, "leader"),
        });
        expect(saved?.money).toBe(225);
        const gathered = await client.query.userItem.findMany({
          where: eq(userItem.userId, "leader"),
        });
        expect(gathered).toHaveLength(1);
        expect(gathered[0]).toMatchObject({ itemId: "herb", quantity: 1 });
        expect(
          saved?.questData
            ?.find((entry) => entry.id === "team-quest")
            ?.goals.find((entry) => entry.id === "goal"),
        ).toMatchObject({ done: true, value: 10, collected: true });
        expect(
          saved?.questData
            ?.find((entry) => entry.id === "team-quest")
            ?.party?.contributions.find((entry) => entry.id === "goal"),
        ).toMatchObject({ done: true, value: 10 });
        const nextReceipt = await client.query.questHistory.findFirst({
          where: eq(questHistory.questId, "next-quest"),
        });
        expect(nextReceipt?.endAt).toBeNull();
        expect(
          (await client.query.questParty.findFirst())?.tracker.goals.find(
            (entry) => entry.id === "goal",
          ),
        ).toMatchObject({ done: false, value: 0 });
        expect(
          (
            await commitQuestObjectiveRewards({
              client,
              userId: "leader",
              user,
              ...reward,
            })
          ).outcome,
        ).toBe("already_completed");
        await fetchUpdatedUser({ client, userId: "leader" });
        const canonical = await client.query.questParty.findFirst();
        expect(
          canonical?.tracker.goals.find((entry) => entry.id === "goal"),
        ).toMatchObject({ done: true, value: 10 });
        const replay = await (await callerFor(questsRouter, "leader")).checkRewards({
          questId: "team-quest",
        });
        expect(replay.rewards?.reward_money).toBe(0);
        expect(
          (
            await client.query.userData.findFirst({
              where: eq(userData.userId, "leader"),
            })
          )?.money,
        ).toBe(225);
        expect(
          await client.query.userItem.findMany({
            where: eq(userItem.userId, "leader"),
          }),
        ).toEqual(gathered);
        expect(
          await client.query.questHistory.findFirst({
            where: eq(questHistory.questId, "team-quest"),
          }),
        ).toEqual(receipt);
        expect(
          await client.query.questHistory.findFirst({
            where: eq(questHistory.questId, "next-quest"),
          }),
        ).toEqual(nextReceipt);
        expect(
          (await client.query.questParty.findFirst())?.tracker.goals.find(
            (entry) => entry.id === "goal",
          )?.value,
        ).toBe(10);
      });
    }
  },
);

/** Fail or miss every shared party write; personal receipt and reward writes still use real SQL. */
const failPartyWrites = (
  client: DrizzleClient,
  failure: "database error" | "CAS misses",
) => {
  let failedWrites = 0;
  return {
    client: aroundStatements(
      client,
      questParty,
      async () => {
        failedWrites++;
        if (failure === "database error")
          throw new Error("Injected party write failure");
        return { rowsAffected: 0 };
      },
      { operations: ["update"] },
    ),
    failedWrites: () => failedWrites,
  };
};

const collectionChainFixture = async () => {
  const client = await getTestDatabase();
  await insertItems([{ id: "scroll" }]);
  await insertQuests([
    teamQuest(
      [
        AllObjectives.parse({
          id: "collect",
          task: "collect_item",
          collectItemIds: ["scroll"],
          item_name: "Scroll",
          sector: 50,
          longitude: 11,
          latitude: 10,
          sectorType: "specific",
          locationType: "specific",
          nextObjectiveId: "next",
        }),
        AllObjectives.parse({
          id: "next",
          task: "new_quest",
          newQuestIds: ["next-quest"],
          nextObjectiveId: "deliver",
        }),
        AllObjectives.parse({
          id: "deliver",
          task: "deliver_item",
          deliverItemIds: ["scroll"],
          item_name: "Scroll",
          sector: 50,
          longitude: 12,
          latitude: 10,
          sectorType: "specific",
          locationType: "specific",
          nextObjectiveId: "wait",
        }),
        AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
      ],
      { consecutiveObjectives: true, maxAttempts: 3, maxCompletes: 3 },
    ),
    {
      id: "next-quest",
      questType: "event",
      hidden: false,
      maxAttempts: 3,
      maxCompletes: 3,
      retryDelay: "none",
      content: {
        objectives: [AllObjectives.parse({ id: "finish", task: "win_quest" })],
        reward: ObjectiveReward.parse({ reward_money: 25 }),
        sceneBackground: "",
        sceneCharacters: [],
      },
    },
  ]);
  const leader = await callerFor(questPartyRouter, "leader");
  const helper = await callerFor(questPartyRouter, "helper");
  expect((await leader.create({ questId: "team-quest", isPublic: true })).success).toBe(
    true,
  );
  const party = (await client.query.questParty.findFirst())!;
  expect((await helper.join({ partyId: party.id })).success).toBe(true);
  return { leader, helper, party };
};

/** Repeated profile/actions preserve inventory and closed quest receipts after personal effects. */
const continueCollectionChainSolo = async (collected?: UserItem[]) => {
  const client = await getTestDatabase();
  const profile = await callerFor(profileRouter, "helper");
  const personal = await callerFor(questsRouter, "helper");
  await profile.getUser();
  const items = await client.query.userItem.findMany({
    where: eq(userItem.userId, "helper"),
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ itemId: "scroll", quantity: 1 });
  if (collected) expect(items).toEqual(collected);
  const started = await client.query.questHistory.findFirst({
    where: and(
      eq(questHistory.userId, "helper"),
      eq(questHistory.questId, "next-quest"),
    ),
  });
  expect(started).toBeDefined();
  expect((await personal.checkRewards({ questId: "next-quest" })).success).toBe(true);
  const nextReceipt = await client.query.questHistory.findFirst({
    where: eq(questHistory.id, started!.id),
  });
  expect(nextReceipt).toMatchObject({
    completed: 1,
    previousAttempts: 1,
    previousCompletes: 1,
  });
  await insertUserItems([{ id: "spare", userId: "helper", itemId: "scroll" }]);
  await client
    .update(userData)
    .set({ longitude: 12 })
    .where(eq(userData.userId, "helper"));
  expect((await personal.checkLocationQuest()).success).toBe(true);
  const remaining = await client.query.userItem.findMany({
    where: eq(userItem.userId, "helper"),
  });
  expect(remaining).toHaveLength(1);
  for (let read = 0; read < 2; read++) {
    await profile.getUser();
    await personal.checkLocationQuest();
    expect(
      await client.query.userItem.findMany({ where: eq(userItem.userId, "helper") }),
    ).toEqual(remaining);
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.id, nextReceipt!.id),
      }),
    ).toEqual(nextReceipt);
  }
  const saved = (await client.query.userData.findFirst({
    where: eq(userData.userId, "helper"),
  }))!;
  const tracker = saved.questData?.find((entry) => entry.id === "team-quest");
  for (const id of ["collect", "next", "deliver"]) {
    expect(tracker?.goals.find((goal) => goal.id === id)).toMatchObject({
      done: true,
      partyEffectsApplied: true,
    });
  }
  expect(saved.money).toBe(125);
};

const claimReleaseFixture = async () => {
  const client = await getTestDatabase();
  await insertTeamQuest(
    [AllObjectives.parse({ id: "goal", task: "stats_trained", value: 100 })],
    { maxAttempts: 3, maxCompletes: 3 },
  );
  const leader = await callerFor(questPartyRouter, "leader");
  const helper = await callerFor(questPartyRouter, "helper");
  expect((await leader.create({ questId: "team-quest", isPublic: true })).success).toBe(
    true,
  );
  const party = (await client.query.questParty.findFirst())!;
  return { leader, helper, party };
};

/** Leave the leader's durable snapshot behind progress actually contributed by a departed helper. */
const lastMemberFixture = async () => {
  const client = await getTestDatabase();
  const { leader, helper, party } = await claimReleaseFixture();
  expect((await helper.join({ partyId: party.id })).success).toBe(true);
  const { user } = await fetchUpdatedUser({ client, userId: "helper" });
  if (!user) throw new Error("Missing helper fixture");
  const updated = getNewTrackers(user, [{ task: "stats_trained", increment: 40 }]);
  user.questData = updated.trackers;
  expect(
    (
      await handleQuestConsequences(
        client,
        user,
        updated.consequences,
        updated.notifications,
        {
          alwaysClaimUserState: true,
          partyTrackers: updated.trackers,
        },
      )
    ).claimed,
  ).toBe(true);
  expect((await client.query.questParty.findFirst())?.tracker.goals[0]?.value).toBe(40);
  const personal = (await client.query.userData.findFirst({
    where: eq(userData.userId, "leader"),
  }))!;
  expect(personal.questData?.[0]?.goals[0]?.value).toBe(0);
  await client
    .update(userData)
    .set({
      questData: [
        ...(personal.questData ?? []),
        QuestTracker.parse({
          id: "unrelated",
          goals: [{ id: "paid", done: true, collected: true }],
        }),
      ],
    })
    .where(eq(userData.userId, "leader"));
  expect((await helper.leave({ partyId: party.id })).success).toBe(true);
  expect((await client.query.questParty.findFirst())?.memberIds).toEqual(["leader"]);
  return { leader, helper, party };
};
