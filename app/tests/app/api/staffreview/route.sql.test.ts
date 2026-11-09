import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import * as ai from "ai";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/staffreview/route";
import { gameSetting, userData, userReview } from "@/drizzle/schema";
import * as comments from "@/routers/comments";
import { insertUsers } from "../../../setup/factories";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const TIMER_NAME = "timer-720h";
const LAST_RUN = new Date(Date.now() - 40 * 24 * 3600 * 1000);

const request = () => new Request("https://example.com/api/staffreview");

const readTimer = async () => {
  const db = await getTestDatabase();
  const [row] = await db
    .select()
    .from(gameSetting)
    .where(eq(gameSetting.name, TIMER_NAME));
  return row;
};

describeWithDatabase("staff review summaries", () => {
  beforeEach(async () => {
    await resetTables(gameSetting, userData, userReview);
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "reviewed", username: "Reviewed", role: "MODERATOR" },
      { userId: "unreviewed", username: "Unreviewed", role: "MODERATOR" },
    ] as never);
    await db.insert(userReview).values({
      id: "review-1",
      authorUserId: "author",
      targetUserId: "reviewed",
      review: "Helpful and quick to respond",
      authorIp: "127.0.0.1",
    });
    await db
      .insert(gameSetting)
      .values({ id: "staff-timer", name: TIMER_NAME, time: LAST_RUN, value: 0 });
    stubDatabase(db);
    stubCronAuth(() => null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it("summarizes only staff who received reviews", async () => {
    const model = vi
      .spyOn(ai, "generateText")
      .mockResolvedValue({ text: "<strong>Strengths:</strong>" } as never);
    const convo = vi
      .spyOn(comments, "createConvo")
      .mockResolvedValue(undefined as never);
    expect((await GET(request())).status).toBe(200);
    expect(model).toHaveBeenCalledTimes(1);
    expect(convo).toHaveBeenCalledTimes(1);
    expect(convo.mock.calls[0]?.[0]).toMatchObject({ receiverUserIds: ["reviewed"] });
  });

  it("hands the period back when a summary fails", async () => {
    vi.spyOn(ai, "generateText").mockRejectedValue(new Error("model unavailable"));
    const convo = vi
      .spyOn(comments, "createConvo")
      .mockResolvedValue(undefined as never);
    expect((await GET(request())).status).toBe(500);
    expect(convo).not.toHaveBeenCalled();
    expect((await readTimer())?.time.getTime()).toBe(LAST_RUN.getTime());
  });
});
