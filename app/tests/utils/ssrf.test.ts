import { describe, expect, it } from "vitest";
import { isPrivateIp, isUrlSafeSynchronous } from "@/utils/ssrf";

describe("isPrivateIp", () => {
  it.each([
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1:1234::c0a8:101",
    "2002:c0a8:0101::1",
    "2002:7f00:0001::1",
    "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "::127.0.0.1",
    "::192.168.1.1",
  ])("blocks IPv6 transition address %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["fe80::1", "febf::1", "fc00::1", "fdff::1", "ff02::1"])(
    "blocks non-public IPv6 address %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    },
  );

  it("allows a public unicast IPv6 address", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  it.each([
    "http://[64:ff9b::a9fe:a9fe]/latest/meta-data/",
    "http://[2002:c0a8:0101::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("rejects transition address URL %s before DNS resolution", (url) => {
    expect(isUrlSafeSynchronous(url)).toBe(false);
  });
});
