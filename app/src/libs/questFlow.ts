import type { Core } from "cytoscape";
import type { QuestNodePositions } from "@/validators/objectives";

/** Capture model coordinates so panning and zooming do not change the saved layout. */
export const getQuestFlowPositions = (cy: Core): QuestNodePositions =>
  Object.fromEntries(
    cy.nodes().map((node) => {
      const { x, y } = node.position();
      return [node.id(), { x, y }];
    }),
  );

/** Restore arranged nodes and place new objectives beside them without moving the layout. */
export const restoreQuestFlowPositions = (cy: Core, positions: QuestNodePositions) => {
  const savedNodes = cy.nodes().filter((node) => Object.hasOwn(positions, node.id()));
  if (savedNodes.empty()) {
    if (cy.nodes().nonempty()) {
      cy.layout({
        name: "cose",
        fit: false,
        randomize: true,
        animate: false,
        nodeOverlap: 20,
      }).run();
    }
  } else {
    savedNodes.forEach((node) => {
      const position = positions[node.id()];
      if (position) node.position(position);
    });
    const bounds = savedNodes.boundingBox();
    cy.nodes()
      .difference(savedNodes)
      .forEach((node, index) => {
        node.position({
          x: bounds.x2 + 100 + (index % 3) * 100,
          y: bounds.y1 + Math.floor(index / 3) * 100,
        });
      });
  }
  return getQuestFlowPositions(cy);
};
