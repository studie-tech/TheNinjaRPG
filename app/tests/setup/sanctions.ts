import { vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { userReport } from "@/drizzle/schema";
import type { SanctionIdentity } from "@/server/utils/sanctionTombstone";
import { getTestDatabase } from "./testDatabase";

type ReportRow = typeof userReport.$inferInsert;
type ClerkUsers = { deleteUser?: (userId: string) => Promise<void> } & Record<
  string,
  unknown
>;

/** Clerk identity with one verified primary email. */
export const sanctionIdentity = (
  email: string,
  accounts: SanctionIdentity["externalAccounts"] = [],
): SanctionIdentity => ({
  primaryEmailAddressId: "primary",
  emailAddresses: [
    { id: "primary", emailAddress: email, verification: { status: "verified" } },
  ],
  externalAccounts: accounts,
});

/** Answer Clerk lookups through `lookup`; an id it does not know is a deleted Clerk user. */
export const stubClerkUsers = (
  lookup: (
    userId: string,
  ) => SanctionIdentity | undefined | Promise<SanctionIdentity | undefined>,
  { deleteUser = async () => {}, ...users }: ClerkUsers = {},
) => {
  const getUser = vi.fn(async (userId: string) => {
    const user = await lookup(userId);
    if (!user) throw Object.assign(new Error("not found"), { status: 404 });
    return user;
  });
  vi.spyOn(clerk, "clerkClient").mockResolvedValue({
    users: { getUser, deleteUser: vi.fn(deleteUser), ...users },
  } as never);
  return getUser;
};

/** Staff-filed tavern reports; a test states who is reported and the case's status. */
export const insertSanctionReports = async (
  reports: (Pick<ReportRow, "id" | "reportedUserId" | "status"> & Partial<ReportRow>)[],
) => {
  const database = await getTestDatabase();
  await database.insert(userReport).values(
    reports.map((report) => ({
      reporterUserId: "staff",
      system: "tavern_comment",
      infraction: {},
      reason: "Spam",
      aiInterpretation: "",
      ...report,
    })),
  );
};
