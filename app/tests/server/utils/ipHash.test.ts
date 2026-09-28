import { describe, expect, it } from "vitest";
import { hashIp } from "@/server/utils/ipHash";

describe("hashIp", () => {
  // Expected values come from MySQL 8.0:
  // SELECT SHA2(CONCAT('development-ip-hash-secret', '<ip>'), 256)
  // Stored addresses are hashed in place with that expression, so the two must agree.
  it("matches MySQL's SHA2(CONCAT(secret, ip), 256)", () => {
    expect(hashIp("203.0.113.7")).toBe(
      "a76d1123babb58d7f2c6f045d77757772b183d76b6152ec3433ddfb3b2b86857",
    );
    expect(hashIp("2001:db8::1")).toBe(
      "12b13bae379343552bb45aebfb8034176227bbbd56fc39c2eceaad7525281402",
    );
  });

  it("fits the 64-character ipHash columns and never contains the address", () => {
    const hash = hashIp("198.51.100.23");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("198.51.100.23");
  });
});
