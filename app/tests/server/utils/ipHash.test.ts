import { describe, expect, it } from "bun:test";
import { hashIpWithKey } from "@/server/utils/ipHash";

const KEY = "development-ip-hash-secret";

describe("hashIpWithKey", () => {
  // Expected values come from MySQL 8.0:
  // SELECT SHA2(CONCAT('development-ip-hash-secret', '<ip>'), 256)
  // Stored addresses are hashed in place with that expression, so the two must agree.
  it("matches MySQL's SHA2(CONCAT(secret, ip), 256)", () => {
    expect(hashIpWithKey("203.0.113.7", KEY)).toBe(
      "a76d1123babb58d7f2c6f045d77757772b183d76b6152ec3433ddfb3b2b86857",
    );
    expect(hashIpWithKey("2001:db8::1", KEY)).toBe(
      "12b13bae379343552bb45aebfb8034176227bbbd56fc39c2eceaad7525281402",
    );
  });

  it("fits the 64-character ipHash columns and never contains the address", () => {
    const hash = hashIpWithKey("198.51.100.23", KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("198.51.100.23");
  });
});
