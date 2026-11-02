import { describe, expect, it } from "bun:test";
import { extractValueFromJson } from "@/utils/regex";

describe("extractValueFromJson", () => {
  it.each([
    ['Updated: {"bloodlineId":"abc","villageId":"xyz"}', "bloodlineId", "abc"],
    ['Updated: {"bloodlineId":"abc","villageId":"xyz"}', "villageId", "xyz"],
    ['Updated: {"villageId": "xyz"}', "villageId", "xyz"],
    ['Updated: {"otherVillageId":"abc"}', "villageId", undefined],
    ['Updated: {"name":"x"}', "villageId", undefined],
  ])("reads %s for key %s", (data, key, expected) => {
    expect(extractValueFromJson(data, key)).toBe(expected);
  });
});
