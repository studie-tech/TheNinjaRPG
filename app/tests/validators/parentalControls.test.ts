import { expect, it } from "bun:test";
import {
  type CommunicationPolicy,
  conversationReadRestriction,
  privateConversationRestriction,
} from "@/libs/parentalControls";
import { hashParentalPin, verifyParentalPin } from "@/server/utils/parentalControls";
import { parentalSettingsSchema } from "@/validators/parentalControls";

const policy: CommunicationPolicy = {
  userId: "child",
  enabled: true,
  tavernDisabled: true,
  privateMessages: "APPROVED",
  approvedUserIds: ["friend"],
};
it("validates PINs and caps approved contacts", () => {
  const input = { ...policy, pin: "012345", version: 0 };
  expect(parentalSettingsSchema.safeParse(input).success).toBe(true);
  for (const pin of ["12345", "1234567", "abcdef", "123 45"])
    expect(parentalSettingsSchema.safeParse({ ...input, pin }).success).toBe(false);
  expect(
    parentalSettingsSchema.safeParse({
      ...input,
      approvedUserIds: Array(51).fill("friend"),
    }).success,
  ).toBe(false);
});
it("requires every group participant to be approved, in both directions", () => {
  expect(privateConversationRestriction([policy], ["child", "friend"])).toBeNull();
  expect(privateConversationRestriction([policy], ["stranger", "child"])).toContain(
    "approved",
  );
  expect(
    privateConversationRestriction([policy], ["child", "friend", "stranger"]),
  ).toContain("approved");
  expect(
    privateConversationRestriction(
      [{ ...policy, enabled: false }],
      ["child", "stranger"],
    ),
  ).toBeNull();
  expect(
    privateConversationRestriction(
      [{ ...policy, privateMessages: "NONE" }],
      ["child", "friend"],
    ),
  ).toContain("disabled");
});
it("blocks public taverns and old stranger conversations while keeping support available", () => {
  const convo = { isPublic: true, isStaffAvailable: false, users: [] };
  expect(conversationReadRestriction(policy, convo)).toContain("Tavern");
  expect(
    conversationReadRestriction(policy, {
      ...convo,
      isPublic: false,
      users: [{ userId: "child" }, { userId: "stranger" }],
    }),
  ).toContain("approved");
  expect(
    conversationReadRestriction(policy, { ...convo, isStaffAvailable: true }),
  ).toBeNull();
});
it("salts hashes and verifies only the correct PIN", async () => {
  const first = await hashParentalPin("012345");
  const second = await hashParentalPin("012345");
  expect(first).not.toBe(second);
  expect(first).not.toContain("012345");
  expect(await verifyParentalPin("012345", first)).toBe(true);
  expect(await verifyParentalPin("543210", first)).toBe(false);
  expect(await verifyParentalPin("012345", "malformed")).toBe(false);
});
