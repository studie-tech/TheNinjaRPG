import { describe, it, expect } from "bun:test";
import { getComboStatus } from "@/libs/combat/ai_v2";

describe("getComboStatus", () => {
  it("Both comboIds and latestActions are empty", () => {
    const result = getComboStatus([], []);
    expect(result).toEqual({ inCombo: false, nextId: undefined });
  });

  it("comboIds is empty, latestActions is not", () => {
    const result = getComboStatus([], ["1", "2", "3"]);
    expect(result).toEqual({ inCombo: false, nextId: undefined });
  });

  it("latestActions is empty, comboIds is not", () => {
    const result = getComboStatus(["1", "2", "3"], []);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("Exact match between latestActions and comboIds", () => {
    const comboIds = ["1", "2", "3"];
    const latestActions = ["1", "2", "3"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("Partial match at the end of latestActions", () => {
    const comboIds = ["1", "2", "3", "4"];
    const latestActions = ["5", "6", "1", "2", "3"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "4" });
  });

  it("No match between latestActions and comboIds", () => {
    const comboIds = ["1", "2", "3"];
    const latestActions = ["4", "5", "6"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("latestActions longer than comboIds with match", () => {
    const comboIds = ["1", "2"];
    const latestActions = ["5", "1", "2"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("latestActions shorter than comboIds with partial match", () => {
    const comboIds = ["1", "2", "3", "4"];
    const latestActions = ["1", "2"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "3" });
  });

  it("Multiple potential matches, should pick the longest", () => {
    const comboIds = ["1", "2", "1", "2", "3"];
    const latestActions = ["1", "2", "1", "2"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "3" });
  });

  it("Match overlaps within latestActions", () => {
    const comboIds = ["1", "2", "1", "2"];
    const latestActions = ["1", "2", "1"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "2" });
  });

  it("latestActions contains comboIds in the middle", () => {
    const comboIds = ["3", "4", "5"];
    const latestActions = ["1", "2", "3", "4", "5", "6"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "3" });
  });

  it("Complete combo achieved multiple times", () => {
    const comboIds = ["1", "2", "3"];
    const latestActions = ["1", "2", "3", "1", "2", "3"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("latestActions has extra actions after completing combo", () => {
    const comboIds = ["1", "2", "3"];
    const latestActions = ["1", "2", "3", "4"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("latestActions partially matches comboIds but not from the start", () => {
    const comboIds = ["1", "2", "3", "4"];
    const latestActions = ["2", "3", "4"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("Repeated actions in comboIds", () => {
    const comboIds = ["1", "1", "2", "2"];
    const latestActions = ["1", "1", "2"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "2" });
  });

  it("latestActions ends with entire comboIds", () => {
    const comboIds = ["1", "2", "3"];
    const latestActions = ["4", "5", "1", "2", "3"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("latestActions has similar but not matching pattern", () => {
    const comboIds = ["1", "2", "3"];
    const latestActions = ["1", "2", "4"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("Very long comboIds and latestActions arrays", () => {
    const comboIds = Array.from({ length: 1000 }, (_, i) => i.toString());
    const latestActions = comboIds.slice(0, 500);
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "500" });
  });

  it("latestActions has multiple partial matches, pick the longest", () => {
    const comboIds = ["1", "2", "3", "4", "5"];
    const latestActions = ["3", "4", "5"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("latestActions matches the middle of comboIds", () => {
    const comboIds = ["1", "2", "3", "4", "5"];
    const latestActions = ["2", "3", "4"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("latestActions has an overlapping pattern with comboIds", () => {
    const comboIds = ["1", "2", "1", "2", "3"];
    const latestActions = ["1", "2", "1", "2"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "3" });
  });

  it("latestActions ends with a partial match that is not the start of comboIds", () => {
    const comboIds = ["1", "2", "3", "4"];
    const latestActions = ["2", "3"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: false, nextId: "1" });
  });

  it("Combo completed multiple times, latestActions ends mid-combo", () => {
    const comboIds = ["1", "2"];
    const latestActions = ["1", "2", "1"];
    const result = getComboStatus(comboIds, latestActions);
    expect(result).toEqual({ inCombo: true, nextId: "2" });
  });
});
