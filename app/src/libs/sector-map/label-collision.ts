export interface LabelScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface LabelCollisionCandidate<T> {
  item: T;
  rect: LabelScreenRect;
  priority: number;
}

const rectanglesOverlap = (a: LabelScreenRect, b: LabelScreenRect, padding: number) =>
  a.left < b.right + padding &&
  a.right > b.left - padding &&
  a.top < b.bottom + padding &&
  a.bottom > b.top - padding;

/**
 * Accept labels in priority order while reserving a small visual gap between
 * them. Reserved rectangles (for example the hovered label) always win.
 */
export const selectNonOverlappingLabels = <T>(
  candidates: LabelCollisionCandidate<T>[],
  reserved: LabelScreenRect[] = [],
  padding = 4,
) => {
  const occupied = [...reserved];
  const accepted: T[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.priority - b.priority)) {
    if (occupied.some((rect) => rectanglesOverlap(candidate.rect, rect, padding))) {
      continue;
    }
    occupied.push(candidate.rect);
    accepted.push(candidate.item);
  }
  return accepted;
};
