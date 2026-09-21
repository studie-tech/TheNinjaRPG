import { describe, expect, it } from "vitest";
import {
  parseShellParam,
  publicPathForShellPath,
  SHELL_PARAMS,
  shellParam,
} from "@/libs/shell";

describe("shell variants", () => {
  it("round-trips every variant through its URL segment", () => {
    for (const client of ["web", "native"] as const) {
      for (const layout of ["default", "pixel"] as const) {
        for (const signedIn of [false, true]) {
          const variant = { client, layout, signedIn };
          expect(parseShellParam(shellParam(variant))).toEqual(variant);
        }
      }
    }
  });

  it.each(["", "web", "web-pixel", "web-pixel-maybe", "mobile-pixel-in", "web-dark-in", "web-pixel-in-x"])(
    "rejects %j, which no rewrite ever produces",
    (param) => {
      expect(parseShellParam(param)).toBeNull();
    },
  );

  it("builds every variant, so the segment can be closed to anything else", () => {
    // With dynamicParams off, a file-like path the proxy skips (/wp-login.php) is a
    // static 404 rather than a render with the file name as the shell.
    expect(SHELL_PARAMS).toEqual([
      "web-default-out",
      "web-default-in",
      "web-pixel-out",
      "web-pixel-in",
      "native-default-out",
      "native-default-in",
      "native-pixel-out",
      "native-pixel-in",
    ]);
    expect(new Set(SHELL_PARAMS.map(parseShellParam)).size).toBe(8);
  });
});

describe("publicPathForShellPath", () => {
  // The variant segment is internal to the rewrite. A request that names one directly
  // must be sent back to the public URL, or the segment leaks into the URL bar and into
  // any link copied from it.
  it.each([
    ["/web-pixel-in/home", "/home"],
    ["/web-default-out", "/"],
    ["/web-default-out/", "/"],
    ["/native-pixel-in/profile/edit", "/profile/edit"],
  ])("maps %s to %s", (path, expected) => {
    expect(publicPathForShellPath(path)).toBe(expected);
  });

  it.each(["/home", "/", "/web-pixel-inside", "/users/web-pixel-in", "/web-pixel-in-x/home"])(
    "leaves %s alone",
    (path) => {
      expect(publicPathForShellPath(path)).toBeNull();
    },
  );
});
