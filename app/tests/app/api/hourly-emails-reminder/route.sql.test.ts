import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import sgMail from "@sendgrid/mail";
import * as Sentry from "@sentry/nextjs";
import { GET } from "@/app/api/hourly-emails-reminder/route";
import { EMAIL_REMINDER_EXPERIENCE_REWARD } from "@/drizzle/constants";
import { emailReminder, userData } from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { insertUsers } from "../../../setup/factories";
import { timerClaimFixture } from "../../../setup/gameTimers";
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

const email = "ninja+tag@example.com";

describeWithDatabase("hourly email reminders", () => {
  beforeEach(async () => {
    await resetTables(emailReminder, userData);
    await insertUsers([{ userId: "lapsed", username: "Lapsed", earnedExperience: 0 }]);
    const db = await getTestDatabase();
    await db.insert(emailReminder).values({
      userId: "lapsed",
      callName: "Lapsed",
      email,
      secret: "secret+/=",
      lastActivity: new Date("2020-01-01T00:00:00Z"),
    });
    stubDatabase(db);
    stubCronAuth(() => null);
    vi.spyOn(gamesettings, "lockWithHourlyTimer").mockResolvedValue({
      ...timerClaimFixture(),
      release: vi.fn(async () => true),
      isNewHour: true,
      prevTime: new Date(0),
      response: Response.json("Ready"),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  const request = () => new Request("https://example.com/api/hourly-emails-reminder");

  it("sends an encoded unsubscribe link and rewards the reminder once", async () => {
    const send = vi.spyOn(sgMail, "send").mockResolvedValue([] as never);
    expect((await GET(request())).status).toBe(200);
    const [message] = send.mock.calls[0] ?? [];
    const url = new URL(
      (Array.isArray(message) ? message[0] : message)?.dynamicTemplateData
        ?.unsubscribeUrl,
    );
    expect(url.searchParams.get("email")).toBe(email);
    expect(url.searchParams.get("secret")).toBe("secret+/=");

    const db = await getTestDatabase();
    const [reminder] = await db.select().from(emailReminder);
    expect(reminder).toMatchObject({ validated: true });
    expect(reminder?.latestRejoinRequest).not.toBeNull();
    const [user] = await db.select().from(userData);
    expect(user?.earnedExperience).toBe(EMAIL_REMINDER_EXPERIENCE_REWARD);
  });

  it("marks the address invalid only when the send is rejected", async () => {
    vi.spyOn(sgMail, "send").mockRejectedValue(new Error("Bad address"));
    expect((await GET(request())).status).toBe(200);
    const db = await getTestDatabase();
    const [reminder] = await db.select().from(emailReminder);
    expect(reminder).toMatchObject({ validated: false });
    const [user] = await db.select().from(userData);
    expect(user?.earnedExperience).toBe(0);
  });
});
