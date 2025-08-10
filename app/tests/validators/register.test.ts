import { describe, it, expect } from "vitest";
import { usernameSchema } from "@/validators/register";

describe("usernameSchema banned words", () => {
  it("rejects usernames that are exactly a banned word", () => {
    const res = usernameSchema.safeParse("anal");
    expect(res.success).toBe(false);
  });

  it("rejects usernames where a token equals a banned word", () => {
    const res = usernameSchema.safeParse("pro_player_ass");
    expect(res.success).toBe(false);
  });

  it("allows usernames that only contain a banned substring as part of a larger token", () => {
    const res1 = usernameSchema.safeParse("assassin");
    expect(res1.success).toBe(true);
    const res2 = usernameSchema.safeParse("classy_name");
    expect(res2.success).toBe(true);
  });

  it("allows clean usernames", () => {
    const res = usernameSchema.safeParse("good_name123");
    expect(res.success).toBe(true);
  });
});
