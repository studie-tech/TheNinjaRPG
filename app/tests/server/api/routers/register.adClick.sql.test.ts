import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  adClick,
  bloodline,
  bloodlineRolls,
  questHistory,
  userAttribute,
  userData,
  userItem,
  village,
} from "@/drizzle/schema";
import { insertAdClickForTrackVisitor } from "@/queries/adConversions";
import {
  insertRegistrationContent,
  registerCharacter,
} from "../../../setup/registration";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const IP = "203.0.113.30";

/** Store a landing click from the registrant's IP, as `trackVisitor` would. */
const landClick = async (clickId: string) =>
  insertAdClickForTrackVisitor(await getTestDatabase(), {
    clickId,
    clickIdType: "gclid",
    ip: IP,
    consent: "unanswered",
  });

const linkedUserOf = async (clickId: string) =>
  (
    await (
      await getTestDatabase()
    ).query.adClick.findFirst({
      where: eq(adClick.clickId, clickId),
    })
  )?.userId;

const register = (
  userId: string,
  consent: { marketingConsent?: "granted" | "declined"; adClickId?: string },
) =>
  registerCharacter(
    userId,
    { username: userId, bloodlineId: "adclick-bloodline", ...consent },
    { userIp: IP },
  );

describeWithDatabase("ad click linking at registration", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      adClick,
      bloodline,
      bloodlineRolls,
      questHistory,
      userAttribute,
      userData,
      userItem,
      village,
    );
    await insertRegistrationContent("adclick");
  });

  it("links the device's click before a newer click from the same IP", async () => {
    await landClick("Cj0KCQiA-device-click");
    await landClick("Cj0KCQiA-newer-ip-click");
    await (await getTestDatabase())
      .update(adClick)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(adClick.clickId, "Cj0KCQiA-device-click"));
    expect(
      await register("DeviceNinja", {
        marketingConsent: "granted",
        adClickId: "Cj0KCQiA-device-click",
      }),
    ).toMatchObject({ success: true, isAdClickLinked: true });
    expect(await linkedUserOf("Cj0KCQiA-device-click")).toBe("DeviceNinja");
    expect(await linkedUserOf("Cj0KCQiA-newer-ip-click")).toBeNull();
  });

  it("falls back to the IP's click and links nothing without consent", async () => {
    await landClick("Cj0KCQiA-ip-click");
    expect(
      await register("DeclineNinja", {
        marketingConsent: "declined",
        adClickId: "Cj0KCQiA-ip-click",
      }),
    ).toMatchObject({ success: true, isAdClickLinked: false });
    expect(await register("SilentNinja", {})).toMatchObject({ isAdClickLinked: false });
    expect(await linkedUserOf("Cj0KCQiA-ip-click")).toBeNull();

    expect(await register("IpNinja", { marketingConsent: "granted" })).toMatchObject({
      isAdClickLinked: true,
    });
    expect(await linkedUserOf("Cj0KCQiA-ip-click")).toBe("IpNinja");
  });
});
