import { describe, expect, it } from "bun:test";
import type { MapAnchorPoint } from "@/libs/mapAnchors";
import {
  placeSpeech,
  SPEECH_TAIL_PX,
  type SpeechObstacle,
  type SpeechRect,
  speakerRect,
} from "@/libs/mapSpeech";

const size = { width: 200, height: 80 };
const point = (patch: Partial<MapAnchorPoint> = {}): MapAnchorPoint => ({
  x: 350,
  foot: 320,
  top: 280,
  tile: 40,
  width: 700,
  height: 600,
  ...patch,
});
const place = (
  patch: Partial<MapAnchorPoint> = {},
  obstacles: SpeechObstacle[] = [],
  previous?: Parameters<typeof placeSpeech>[0]["previous"],
) => placeSpeech({ point: point(patch), size, obstacles, previous });
const overlaps = (a: SpeechRect, b: SpeechRect) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

describe("placeSpeech", () => {
  it("stands over its speaker, its tail on them", () => {
    expect(place()).toEqual({
      side: "above",
      left: 250,
      top: 280 - SPEECH_TAIL_PX - 80,
      tail: 100,
    });
  });

  it("stays whole on the map and points its tail at a speaker near the edge", () => {
    const placement = place({ x: 60 });
    expect(placement.left).toBe(8);
    expect(placement.tail).toBe(52);
  });

  it("takes another side when the one above has no room", () => {
    const placement = place({ top: 20, foot: 60 });
    expect(placement.side).not.toBe("above");
    expect(
      overlaps({ ...placement, ...size }, speakerRect(point({ top: 20, foot: 60 }))),
    ).toBe(false);
  });

  it("keeps the player and targets in view, sparing a map panel first", () => {
    const player = {
      kind: "subject",
      left: 355,
      top: 340,
      width: 40,
      height: 40,
    } as const;
    const target = {
      kind: "subject",
      left: 320,
      top: 325,
      width: 50,
      height: 40,
    } as const;
    const panel = {
      kind: "panel",
      left: 240,
      top: 180,
      width: 130,
      height: 60,
    } as const;
    const placement = place({}, [player, target, panel]);
    const rect = { ...placement, ...size };
    expect(overlaps(rect, player)).toBe(false);
    expect(overlaps(rect, target)).toBe(false);
    // With the sides blocked as well, only the panel is left to cover.
    const beside = [
      { kind: "subject", left: 380, top: 200, width: 320, height: 300 },
      { kind: "subject", left: 0, top: 200, width: 320, height: 300 },
    ] as const;
    expect(place({}, [player, target, panel, ...beside]).side).toBe("above");
  });

  it("leaves another bubble readable", () => {
    const other = {
      kind: "speech",
      left: 250,
      top: 190,
      width: 200,
      height: 80,
    } as const;
    expect(overlaps({ ...place({}, [other]), ...size }, other)).toBe(false);
  });

  it("does not jump sides for a little more room", () => {
    const sliver = {
      kind: "speech",
      left: 250,
      top: 190,
      width: 4,
      height: 60,
    } as const;
    expect(place({}, [sliver]).side).toBe("right");
    expect(place({}, [sliver], "above").side).toBe("above");
  });

  it("waits at the edge nearest to a speaker off the map", () => {
    const placement = place({ x: 900 });
    expect(placement.left).toBe(700 - 200 - 8);
    expect(placement.tail).toBe(200 - 16);
  });
});
