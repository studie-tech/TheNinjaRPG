import { describe, expect, it } from "bun:test";
import cytoscape from "cytoscape";
import { getQuestFlowPositions, restoreQuestFlowPositions } from "@/libs/questFlow";

const graph = (ids: string[]) =>
  cytoscape({
    headless: true,
    elements: ids.map((id) => ({ data: { id } })),
  });

describe("quest designer layout", () => {
  it("restores shared coordinates exactly after serializing and reopening", () => {
    const first = graph(["start", "end"]);
    const reopened = graph(["start", "end"]);
    try {
      first.getElementById("start").position({ x: -125.5, y: 300 });
      first.getElementById("end").position({ x: 420, y: -70.25 });
      const saved = JSON.parse(JSON.stringify(getQuestFlowPositions(first)));
      expect(restoreQuestFlowPositions(reopened, saved)).toEqual(saved);
      expect(restoreQuestFlowPositions(reopened, saved)).toEqual(saved);
    } finally {
      first.destroy();
      reopened.destroy();
    }
  });

  it("positions added and copied objectives without moving arranged nodes", () => {
    const cy = graph(["start", "end", "new", "copy"]);
    const saved = { start: { x: 20, y: 70 }, end: { x: 200, y: 500 } };
    try {
      const positions = restoreQuestFlowPositions(cy, saved);
      expect(positions).toMatchObject(saved);
      expect(positions.new!.x).toBeGreaterThan(saved.end.x);
      expect(positions.copy).not.toEqual(positions.new);
      expect(restoreQuestFlowPositions(cy, positions)).toEqual(positions);
    } finally {
      cy.destroy();
    }
  });

  it("drops deleted nodes and saves model coordinates independently of the viewport", () => {
    const cy = graph(["start", "end"]);
    try {
      restoreQuestFlowPositions(cy, {
        start: { x: 20, y: 70 },
        end: { x: 200, y: 500 },
      });
      cy.getElementById("end").remove();
      cy.zoom(2);
      cy.pan({ x: 100, y: 200 });
      cy.getElementById("start").position({ x: -90, y: 150 });
      expect(getQuestFlowPositions(cy)).toEqual({ start: { x: -90, y: 150 } });
    } finally {
      cy.destroy();
    }
  });

  it("automatically arranges quests without saved positions, including empty quests", () => {
    const cy = graph(["start", "end"]);
    try {
      const positions = restoreQuestFlowPositions(cy, {});
      expect(Object.keys(positions)).toEqual(["start", "end"]);
      expect(positions.start).not.toEqual(positions.end);
      for (const position of Object.values(positions)) {
        expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
      }
      cy.nodes().remove();
      expect(restoreQuestFlowPositions(cy, positions)).toEqual({});
    } finally {
      cy.destroy();
    }
  });
});
