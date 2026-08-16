/**
 * Content-agnostic evolution helpers.
 * Plug into jutsu/items (or future content) by supplying a parentId field + graph nodes.
 */

import { EVOLUTION_MAX_CHILDREN, EVOLUTION_MAX_DEPTH } from "@/drizzle/constants";
import type { MasteryRequirementFields, MasteryStatSource } from "@/libs/mastery";
import { hasMasteryRequirements } from "@/libs/mastery";

/** Minimal node for validating parent/child evolution graphs. */
export type EvolutionNode = {
  id: string;
  parentId: string | null;
};

/** Nullable per-stat gates used when evolving owned content. */
export type EvolutionStatRequirements = MasteryRequirementFields & {
  requiredStrength?: number | null;
  requiredSpeed?: number | null;
  requiredIntelligence?: number | null;
  requiredWillpower?: number | null;
};

export type EvolutionUserStats = MasteryStatSource & {
  strength: number;
  speed: number;
  intelligence: number;
  willpower: number;
};

export const isEvolution = (parentId: string | null | undefined): boolean => !!parentId;

export const meetsEvolutionStatRequirements = (
  requirements: EvolutionStatRequirements,
  stats: EvolutionUserStats,
): boolean => {
  const checks: { req: number | null | undefined; val: number }[] = [
    { req: requirements.requiredStrength, val: stats.strength },
    { req: requirements.requiredSpeed, val: stats.speed },
    { req: requirements.requiredIntelligence, val: stats.intelligence },
    { req: requirements.requiredWillpower, val: stats.willpower },
  ];
  return (
    hasMasteryRequirements(stats, requirements) &&
    checks.every(({ req, val }) => req === null || req === undefined || val >= req)
  );
};

export type EvolutionGraphValidation = { ok: true } | { ok: false; message: string };

/**
 * Validate parent pointer + sibling/depth/cycle constraints for an evolution edge.
 * `graph` should include all content rows that have a parentId (children only is fine).
 * Pass `parentParentId` from the fetched parent row (it may be a root and absent from graph).
 */
export const validateEvolutionGraph = (opts: {
  contentId: string;
  parentId: string;
  parentExists: boolean;
  /** Immediate parent's own parentId (null if parent is a root). */
  parentParentId: string | null;
  /** Sibling content ids under the same parent (may include contentId on re-save). */
  siblingIds: string[];
  graph: EvolutionNode[];
  contentLabel?: string;
}): EvolutionGraphValidation => {
  const label = opts.contentLabel ?? "content";
  if (opts.parentId === opts.contentId) {
    return { ok: false, message: `A ${label} cannot be its own parent` };
  }
  if (!opts.parentExists) {
    return { ok: false, message: `Parent ${label} not found` };
  }

  const siblingCount = opts.siblingIds.filter((id) => id !== opts.contentId).length;
  if (siblingCount >= EVOLUTION_MAX_CHILDREN) {
    return {
      ok: false,
      message: `A ${label} can have a maximum of ${EVOLUTION_MAX_CHILDREN} evolutions`,
    };
  }

  const byId = new Map(opts.graph.map((node) => [node.id, node] as const));

  // Walk upward from parent for ancestor depth + cycles
  let ancestorDepth = 1;
  let ancestorParentId = opts.parentParentId;
  const visitedAncestors = new Set<string>([opts.parentId]);
  while (ancestorParentId) {
    if (ancestorParentId === opts.contentId) {
      return { ok: false, message: "Cannot create a circular evolution chain" };
    }
    if (visitedAncestors.has(ancestorParentId)) break;
    visitedAncestors.add(ancestorParentId);
    const nextAncestor = byId.get(ancestorParentId);
    ancestorDepth++;
    if (!nextAncestor) break;
    ancestorParentId = nextAncestor.parentId;
  }

  // Walk downward from contentId for descendant depth
  const childrenByParent = new Map<string, string[]>();
  for (const node of opts.graph) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }
  let descendantDepth = 1;
  let frontier = [opts.contentId];
  const visitedDescendants = new Set<string>([opts.contentId]);
  while (frontier.length > 0) {
    const nextFrontier = frontier
      .flatMap((parentId) => childrenByParent.get(parentId) ?? [])
      .filter((id) => !visitedDescendants.has(id));
    if (nextFrontier.length === 0) break;
    for (const id of nextFrontier) visitedDescendants.add(id);
    frontier = nextFrontier;
    descendantDepth++;
  }

  if (ancestorDepth + descendantDepth > EVOLUTION_MAX_DEPTH) {
    return {
      ok: false,
      message: `Maximum evolution chain depth is ${EVOLUTION_MAX_DEPTH}`,
    };
  }

  return { ok: true };
};

/** Hide draft evolutions unless the viewer can change content. */
export const filterVisibleEvolutions = <T extends { hidden: boolean }>(
  evolutions: T[],
  canViewHidden: boolean,
): T[] => evolutions.filter((evolution) => !evolution.hidden || canViewHidden);

/** Labels for evolution stat requirement UI (shared across content editors). */
export const EVOLUTION_STAT_FORM_FIELDS = [
  { id: "requiredNinjutsuMastery", label: "Req. Ninjutsu Mastery" },
  { id: "requiredGenjutsuMastery", label: "Req. Genjutsu Mastery" },
  { id: "requiredTaijutsuMastery", label: "Req. Taijutsu Mastery" },
  { id: "requiredBukijutsuMastery", label: "Req. Bukijutsu Mastery" },
  { id: "requiredBloodlineMastery", label: "Req. Bloodline Mastery" },
  { id: "requiredSageMastery", label: "Req. Sage Mastery" },
  { id: "requiredStrength", label: "Req. Strength" },
  { id: "requiredSpeed", label: "Req. Speed" },
  { id: "requiredIntelligence", label: "Req. Intelligence" },
  { id: "requiredWillpower", label: "Req. Willpower" },
] as const;
