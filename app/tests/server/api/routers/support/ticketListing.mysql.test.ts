import { beforeEach, expect, it } from "bun:test";
import { cannedResponse, supportTicket, userData } from "@/drizzle/schema";
import { supportRouter } from "@/server/api/routers/support";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const day = 86_400_000;
const start = Date.UTC(2026, 0, 10);

type TicketFilters = Parameters<
  ReturnType<typeof supportRouter.createCaller>["getTickets"]
>[0];

const ids = async (userId: string, filters: TicketFilters) => {
  const caller = await callerFor(supportRouter, userId);
  return (await caller.getTickets(filters)).data.map((ticket) => ticket?.id);
};

describeWithDatabase("support ticket listing", () => {
  beforeEach(async () => {
    await resetTables(cannedResponse, supportTicket, userData);
    await insertUsers([
      { userId: "player", username: "Player" },
      { userId: "staff", username: "Staff", role: "MODERATOR" },
    ]);
    const tickets = [
      {
        id: "a",
        priority: "HIGH",
        status: "OPEN",
        category: "BUG_REPORT",
        isPublic: false,
        title: "Broken map",
        tags: ["map"],
        createdByUserId: "player",
        assignedToUserId: "staff",
      },
      {
        id: "b",
        priority: "LOW",
        status: "RESOLVED",
        category: "OTHER",
        isPublic: true,
        title: "Thanks",
        tags: [],
        createdByUserId: "staff",
        assignedToUserId: null,
      },
      {
        id: "c",
        priority: "URGENT",
        status: "CLOSED",
        category: "BUG_REPORT",
        isPublic: false,
        title: "Private",
        tags: ["map", "pvp"],
        createdByUserId: "staff",
        assignedToUserId: null,
      },
    ] as const;
    await (await getTestDatabase()).insert(supportTicket).values(
      tickets.map((ticket, index) => ({
        ...ticket,
        tags: [...ticket.tags],
        description: `Description ${ticket.id}`,
        conversationId: ticket.id,
        createdAt: new Date(start + index * day),
        updatedAt: new Date(start + (2 - index) * day),
      })),
    );
  });

  it("orders by each supported column and direction, newest first by default", async () => {
    expect(await ids("staff", {})).toEqual(["c", "b", "a"]);
    expect(await ids("staff", { orderDirection: "asc" })).toEqual(["a", "b", "c"]);
    expect(await ids("staff", { orderBy: "updatedAt" })).toEqual(["a", "b", "c"]);
    expect(await ids("staff", { orderBy: "updatedAt", orderDirection: "asc" })).toEqual(
      ["c", "b", "a"],
    );
    expect(await ids("staff", { orderBy: "priority", orderDirection: "asc" })).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(await ids("staff", { orderBy: "priority" })).toEqual(["c", "a", "b"]);
    expect(await ids("staff", { orderBy: "status", orderDirection: "asc" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("combines every filter", async () => {
    const newest = { orderDirection: "asc" } as const;
    expect(await ids("staff", { ...newest, status: ["OPEN", "CLOSED"] })).toEqual([
      "a",
      "c",
    ]);
    expect(await ids("staff", { ...newest, category: ["BUG_REPORT"] })).toEqual([
      "a",
      "c",
    ]);
    expect(await ids("staff", { ...newest, priority: ["LOW", "HIGH"] })).toEqual([
      "a",
      "b",
    ]);
    expect(await ids("staff", { assignedToUserId: "staff" })).toEqual(["a"]);
    expect(await ids("staff", { ...newest, createdByUserId: "staff" })).toEqual([
      "b",
      "c",
    ]);
    expect(await ids("staff", { isPublic: true })).toEqual(["b"]);
    expect(await ids("staff", { isPublic: false, ...newest })).toEqual(["a", "c"]);
    expect(await ids("staff", { search: "Description b" })).toEqual(["b"]);
    expect(await ids("staff", { search: "Broken" })).toEqual(["a"]);
    expect(
      await ids("staff", { dateFrom: new Date(start + day).toISOString(), ...newest }),
    ).toEqual(["b", "c"]);
    expect(
      await ids("staff", { dateTo: new Date(start + day).toISOString(), ...newest }),
    ).toEqual(["a", "b"]);
    expect(await ids("staff", { tags: ["pvp"] })).toEqual(["c"]);
    expect(await ids("staff", { tags: ["pvp", "map"], ...newest })).toEqual(["a", "c"]);
    expect(
      await ids("staff", {
        status: [],
        category: [],
        priority: [],
        tags: [],
        ...newest,
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("limits players to their own and public tickets", async () => {
    expect(await ids("player", { orderDirection: "asc" })).toEqual(["a", "b"]);
  });

  it("answers a missing ticket and a private ticket with their own codes", async () => {
    const player = await callerFor(supportRouter, "player");
    await expect(player.getTicket({ ticketId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Ticket not found",
    });
    await expect(player.getTicket({ ticketId: "c" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Access denied",
    });
    expect(await player.getTicket({ ticketId: "a" })).toMatchObject({ id: "a" });
  });

  it("shares canned responses with staff only", async () => {
    await (await getTestDatabase()).insert(cannedResponse).values({
      id: "canned",
      title: "Greeting",
      description: "Thanks for reaching out",
      createdByUserId: "staff",
    });
    const [player, staff] = await Promise.all([
      callerFor(supportRouter, "player"),
      callerFor(supportRouter, "staff"),
    ]);
    expect(await player.getCannedResponses()).toEqual([]);
    expect(await staff.getCannedResponses()).toEqual([
      expect.objectContaining({ id: "canned", title: "Greeting" }),
    ]);
  });
});
