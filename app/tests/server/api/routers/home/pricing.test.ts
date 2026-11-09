import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData, userHome, userItem } from "@/drizzle/schema";
import { homeRouter } from "@/server/api/routers/home";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "home-shopper";
const money = 100_000_000;

const wallet = async () =>
  (await (
    await getTestDatabase()
  ).query.userData.findFirst({ where: eq(userData.userId, userId) }))!;

/** Moving up pays the price difference; moving down refunds three quarters of it. */
describeWithDatabase("home move pricing", () => {
  beforeEach(async () => {
    await resetTables(userHome, userItem, item, userData);
    await insertUsers([
      {
        userId,
        username: "HomeShopper",
        homeType: "TOWN_HOUSE",
        status: "AWAKE",
        money,
      },
    ]);
  });

  it("quotes every other home type", async () => {
    const quotes = await (await callerFor(homeRouter, userId)).getAvailableUpgrades();
    expect(
      Object.fromEntries(
        quotes.map((q) => [q.type, [q.isUpgrade, q.upgradeCost, q.downgradeRefund]]),
      ),
    ).toEqual({
      NONE: [false, 0, 26_250_000],
      STUDIO_APARTMENT: [false, 0, 24_000_000],
      ONE_BED_APARTMENT: [false, 0, 18_750_000],
      TWO_BED_HOUSE: [false, 0, 11_250_000],
      MANSION: [true, 65_000_000, 0],
      PALACE: [true, 265_000_000, 0],
      MARSHMALLOWOPOLIS: [true, 465_000_000, 0],
    });
  });

  it("charges the difference for an upgrade", async () => {
    expect(
      await (await callerFor(homeRouter, userId)).upgradeHome({ homeType: "MANSION" }),
    ).toMatchObject({ success: true });
    expect(await wallet()).toMatchObject({
      homeType: "MANSION",
      money: money - 65_000_000,
    });
  });

  it("refunds three quarters of the difference for a downgrade", async () => {
    expect(
      await (await callerFor(homeRouter, userId)).upgradeHome({
        homeType: "STUDIO_APARTMENT",
      }),
    ).toMatchObject({ success: true });
    expect(await wallet()).toMatchObject({
      homeType: "STUDIO_APARTMENT",
      money: money + 24_000_000,
    });
  });
});
