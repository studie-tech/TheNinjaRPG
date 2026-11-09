import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { historicalAvatar, historicalSoundEffect } from "@/drizzle/schema";
import { audioRouter } from "@/server/api/routers/audio";
import { avatarRouter } from "@/server/api/routers/avatar";
import type { mediaHistoryQuerySchema } from "@/validators/mediaHistory";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "media-history-user";
type HistoryInput = z.input<typeof mediaHistoryQuerySchema>;

const histories = [
  {
    name: "avatars",
    page: async (input: HistoryInput) =>
      (await callerFor(avatarRouter, userId)).getHistoricalAvatars(input),
  },
  {
    name: "audio",
    page: async (input: HistoryInput) =>
      (await callerFor(audioRouter, userId)).getHistorical(input),
  },
];

const seedHistory = async (
  ids: number[],
  relationId = userId,
  done = true,
  hasMedia = true,
) => {
  const database = await getTestDatabase();
  await Promise.all([
    database.insert(historicalAvatar).values(
      ids.map((id) => ({
        id,
        userId: relationId,
        done,
        avatar: hasMedia ? `https://example.com/avatar-${id}.png` : null,
      })),
    ),
    database.insert(historicalSoundEffect).values(
      ids.map((id) => ({
        id,
        // Content audio is selected by relation, independently of its creator.
        userId: "media-creator",
        relationId,
        done,
        url: hasMedia ? `https://example.com/audio-${id}.mp3` : null,
      })),
    ),
  ]);
};

for (const history of histories) {
  describeWithDatabase(`${history.name} history pagination`, () => {
    beforeEach(async () => {
      await resetTables(historicalAvatar, historicalSoundEffect);
    });

    it("returns the lookahead row on the next page when IDs exceed offsets", async () => {
      const ids = Array.from({ length: 25 }, (_, index) => 1000 - index);
      await seedHistory(ids);
      const first = await history.page({ limit: 20 });
      expect(first.data.map((row) => row.id)).toEqual(ids.slice(0, 20));
      expect(first.nextCursor).toBe(ids[20]);

      const second = await history.page({ limit: 20, cursor: first.nextCursor! });
      expect(second.data.map((row) => row.id)).toEqual(ids.slice(20));
      expect(second.nextCursor).toBeUndefined();
    });

    it("defaults omitted and null inputs to the actor's first 50 records", async () => {
      const ids = Array.from({ length: 51 }, (_, index) => 1000 - index);
      await seedHistory(ids);
      for (const input of [{}, { relationId: null, limit: null, cursor: null }]) {
        const result = await history.page(input);
        expect(result.data.map((row) => row.id)).toEqual(ids.slice(0, 50));
        expect(result.nextCursor).toBe(ids[50]);
      }
    });

    it("rejects invalid page sizes and record IDs", async () => {
      for (const input of [
        { limit: 0 },
        { limit: 101 },
        { limit: 1.5 },
        { cursor: 0 },
        { cursor: -1 },
        { cursor: 1.5 },
      ]) {
        await expect(history.page(input)).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
    });

    it("keeps filters and descending order across multiple pages with ID gaps", async () => {
      const ids = [1000, 950, 800, 700, 650, 500, 100];
      const relationId = "content-relation";
      await seedHistory(ids, relationId);
      await seedHistory([990, 750, 550], "another-relation");
      await seedHistory([980, 740, 540], relationId, false);
      await seedHistory([970, 730, 530], relationId, true, false);
      await seedHistory([960, 720, 520]);

      const received: number[] = [];
      let cursor: number | undefined;
      for (let page = 0; page < 4; page++) {
        const result = await history.page({ relationId, limit: 2, cursor });
        received.push(...result.data.map((row) => row.id));
        cursor = result.nextCursor ?? undefined;
        if (page < 3) expect(cursor).toBe(ids[(page + 1) * 2]);
        else expect(cursor).toBeUndefined();
      }
      expect(received).toEqual(ids);
    });

    for (const count of [0, 1, 20, 40]) {
      it(`terminates without an extra page for ${count} records`, async () => {
        const ids = Array.from({ length: count }, (_, index) => 1000 - index);
        if (count > 0) await seedHistory(ids);
        const first = await history.page({ limit: 20 });
        if (count <= 20) {
          expect(first.data.map((row) => row.id)).toEqual(ids);
          expect(first.nextCursor).toBeUndefined();
        } else {
          const second = await history.page({ limit: 20, cursor: first.nextCursor! });
          expect([...first.data, ...second.data].map((row) => row.id)).toEqual(ids);
          expect(second.nextCursor).toBeUndefined();
        }
      });
    }

    it("continues without duplicates when newer history arrives between requests", async () => {
      await seedHistory([1000, 900, 800, 700, 600]);
      const first = await history.page({ limit: 2 });
      await seedHistory([1100, 1050]);
      const second = await history.page({ limit: 2, cursor: first.nextCursor! });
      const third = await history.page({ limit: 2, cursor: second.nextCursor! });
      expect(
        [...first.data, ...second.data, ...third.data].map((row) => row.id),
      ).toEqual([1000, 900, 800, 700, 600]);
      expect(third.nextCursor).toBeUndefined();
      expect((await history.page({ limit: 2 })).data.map((row) => row.id)).toEqual([
        1100, 1050,
      ]);
    });

    it("continues past a deleted lookahead row", async () => {
      await seedHistory([1000, 900, 800, 700]);
      const first = await history.page({ limit: 2 });
      const database = await getTestDatabase();
      await Promise.all([
        database.delete(historicalAvatar).where(eq(historicalAvatar.id, 800)),
        database.delete(historicalSoundEffect).where(eq(historicalSoundEffect.id, 800)),
      ]);
      const second = await history.page({ limit: 2, cursor: first.nextCursor! });
      expect(second.data.map((row) => row.id)).toEqual([700]);
      expect(second.nextCursor).toBeUndefined();
    });
  });
}
