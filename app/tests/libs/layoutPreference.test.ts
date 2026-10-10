import { afterEach, describe, expect, it } from "bun:test";
import {
  LAYOUT_PREFERENCE_COOKIE,
  persistLayoutPreferenceCookie,
} from "@/libs/layoutPreference";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

describe("persistLayoutPreferenceCookie", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "cookieStore");
    // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie this test writes.
    document.cookie = `${LAYOUT_PREFERENCE_COOKIE}=; path=/; max-age=0`;
  });

  it("keeps the document cookie when the Cookie Store mirror rejects", async () => {
    const reasons: unknown[] = [];
    const onRejection = (reason: unknown) => {
      reasons.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    Object.defineProperty(window, "cookieStore", {
      configurable: true,
      value: {
        set: () =>
          Promise.reject(
            new DOMException(
              "Failed to execute 'set' on 'CookieStore': An unknown error occurred while writing the cookie.",
              "UnknownError",
            ),
          ),
      },
    });

    persistLayoutPreferenceCookie("pixel");
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", onRejection);

    expect(reasons).toEqual([]);
    expect(document.cookie).toContain(`${LAYOUT_PREFERENCE_COOKIE}=pixel`);
  });
});
