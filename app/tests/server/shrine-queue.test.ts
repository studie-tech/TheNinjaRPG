import { describe, it, expect } from "vitest";
import { shrineRouter } from "@/server/api/routers/shrine";

describe("shrineRouter MPVP Shrine Wars queue endpoints", () => {
  it("should expose queue endpoints", () => {
    const procs = (shrineRouter as any)?._def?.procedures ?? {};
    expect(typeof procs.queueForShrineAttack).toBe("function");
    expect(typeof procs.queueForShrineDefense).toBe("function");
    expect(typeof procs.leaveShrineQueue).toBe("function");
    expect(typeof procs.initiateShrineBattle).toBe("function");
  });
});
