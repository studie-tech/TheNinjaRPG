import { afterEach, describe, expect, it, vi } from "bun:test";
import * as google from "@next/third-parties/google";
import { trackConversion } from "@/libs/conversionTracking";

afterEach(() => vi.restoreAllMocks());

describe("confirmed conversion delivery", () => {
  it("deduplicates a replayed receipt while keeping distinct conversions separate", () => {
    const send = vi.spyOn(google, "sendGTMEvent").mockImplementation(() => undefined);
    trackConversion("register", "signup-replayed");
    trackConversion("register", "signup-replayed");
    trackConversion("tutorial_complete", "graduation-claimed");
    trackConversion("tutorial_complete", "graduation-claimed");
    expect(send.mock.calls).toEqual([
      [
        {
          event: "register",
          transaction_id: "register:signup-replayed",
          userId: "signup-replayed",
        },
      ],
      [
        {
          event: "tutorial_complete",
          transaction_id: "tutorial_complete:graduation-claimed",
        },
      ],
    ]);
  });

  it("does not invent conversions for responses without a confirmed receipt", () => {
    const send = vi.spyOn(google, "sendGTMEvent").mockImplementation(() => undefined);
    trackConversion("tutorial_complete", undefined);
    trackConversion("register", "");
    expect(send).not.toHaveBeenCalled();
  });

  it("allows delivery to be retried if the data layer push throws", () => {
    const send = vi
      .spyOn(google, "sendGTMEvent")
      .mockImplementationOnce(() => {
        throw new Error("Unavailable");
      })
      .mockImplementation(() => undefined);
    expect(() => trackConversion("register", "signup-retry")).not.toThrow();
    trackConversion("register", "signup-retry");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
