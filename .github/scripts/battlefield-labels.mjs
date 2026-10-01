/** Keep sheet captions within battlefieldSheetsSchema's limits. Full labels stay in the index. */
const caption = (text, limit) =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;

/** Prepare render requests and an index mapping their captions to the complete candidate labels. */
export const prepareBattlefieldLabels = (requests) => ({
  requests: requests.map((request) => ({
    ...request,
    title: caption(request.title, 200),
    variants: request.variants.map((variant) => ({
      ...variant,
      name: caption(variant.name, 160),
    })),
  })),
  blocks: requests.map((request) => ({
    title: caption(request.title, 200),
    description: request.title,
    entityType: request.entityType,
    entityId: request.entityId,
    variants: request.variants.map((variant) => ({
      name: caption(variant.name, 160),
      description: variant.name,
    })),
  })),
});
