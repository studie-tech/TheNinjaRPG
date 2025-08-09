"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Check, Lock, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRouter } from "next/navigation";
import Modal2 from "@/layout/Modal2";
import type { SkillTree, UserSkill } from "@/drizzle/schema";
import { MultiSelect } from "@/components/ui/multi-select";
import type { OptionType } from "@/components/ui/multi-select";

interface SkillTreeGraphProps {
  skills: SkillTree[];
  userSkills?: (UserSkill & { skill: SkillTree })[];
  userSkillPoints?: number;
  adminMode?: boolean;
  onPurchaseSkill?: (skillId: string) => void;
}

interface SkillNode extends SkillTree {
  x: number;
  y: number;
  tier: number;
  canPurchase: boolean;
  isOwned: boolean;
  isActivated: boolean;
  hasPrereqs: boolean;
  hasPoints: boolean;
}

export default function SkillTreeGraph({
  skills,
  userSkills = [],
  userSkillPoints = 0,
  adminMode = false,
  onPurchaseSkill,
}: SkillTreeGraphProps) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [skillNodes, setSkillNodes] = useState<SkillNode[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillNode | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Viewport state for panning and zooming
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });

  // Get all unique effect types from skills
  const allEffectTypes = Array.from(
    new Set(
      skills.flatMap((skill) => skill.effects?.map((effect) => effect.type) || []),
    ),
  ).sort();

  // Get activated skill IDs for easier lookup
  const activatedSkillIds = userSkills
    .filter((us) => us.activated)
    .map((us) => us.skillId);

  // Get all owned skill IDs (activated or not)
  const ownedSkillIds = userSkills.map((us) => us.skillId);

  // Hide SPECIAL skills unless user owns them (only in non-admin mode),
  // then filter by selected categories (OR logic)
  const visibleSkills = adminMode
    ? skills
    : skills.filter((s) => s.skillType !== "SPECIAL" || ownedSkillIds.includes(s.id));
  const filteredSkills =
    selectedCategories.length > 0
      ? visibleSkills.filter((skill) =>
          skill.effects?.some((effect) => selectedCategories.includes(effect.type)),
        )
      : visibleSkills;

  // Layout skills in a tree structure
  useEffect(() => {
    if (!filteredSkills.length) return;

    /* -------------------------------------------------------------------------- */
    /*                        BASIC LAYOUT CONSTANTS                              */
    /* -------------------------------------------------------------------------- */
    const tierWidth = 300; // Horizontal spacing between tier columns
    const skillHeight = 240; // Vertical spacing between rows
    const padding = 10; // Top-left padding

    /* -------------------------------------------------------------------------- */
    /*                          GROUP SKILLS BY TIER                              */
    /* -------------------------------------------------------------------------- */
    const skillsByTier: Record<number, SkillTree[]> = {};
    filteredSkills.forEach((skill) => {
      if (!skillsByTier[skill.tier]) skillsByTier[skill.tier] = [];
      skillsByTier[skill.tier]!.push(skill);
    });

    const tiers = Object.keys(skillsByTier)
      .map(Number)
      .sort((a, b) => a - b);

    /* -------------------------------------------------------------------------- */
    /*               GENERIC BARYCENTER-BASED LAYOUT ENGINE (n-tiers)             */
    /* -------------------------------------------------------------------------- */

    /** Map skillId → row index (integer). */
    const rowAssignment: Record<string, number> = {};

    /** Track occupied rows per tier so we avoid collisions. */
    const rowsUsedByTier: Record<number, Set<number>> = {};

    /** Helper that returns the nearest free row ≥ desiredRow for a tier. */
    const getNearestFreeRow = (tier: number, desiredRow: number): number => {
      if (!rowsUsedByTier[tier]) rowsUsedByTier[tier] = new Set();
      let row = desiredRow;
      // Always search upward until we find a free slot.
      while (rowsUsedByTier[tier].has(row)) row += 1;
      rowsUsedByTier[tier].add(row);
      return row;
    };

    /** Pushes the node with final coordinates + metadata. */
    const nodes: SkillNode[] = [];
    const pushNode = (skill: SkillTree, tier: number, row: number) => {
      const x = padding + 50 + (tier - 1) * tierWidth;
      const y = padding + row * skillHeight;

      const isOwned = ownedSkillIds.includes(skill.id);
      const isActivated = activatedSkillIds.includes(skill.id);
      const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
        activatedSkillIds.includes(reqId),
      );
      const hasPoints = userSkillPoints >= skill.costSkillPoints;
      // Can purchase if: not owned OR owned but not activated
      const canPurchase =
        (!isOwned || (isOwned && !isActivated)) &&
        hasPrereqs &&
        hasPoints &&
        !adminMode;

      nodes.push({
        ...skill,
        x,
        y,
        tier,
        canPurchase,
        isOwned,
        isActivated,
        hasPrereqs,
        hasPoints,
      });

      rowAssignment[skill.id] = row;
    };

    /* --------------------------- LAYER-BY-LAYER PASS --------------------------- */

    tiers.forEach((tier) => {
      const tierSkills = skillsByTier[tier] || [];

      // Compute barycenter (average parent row) for each skill.
      type WithBary = { skill: SkillTree; bary: number };
      const withBary: WithBary[] = tierSkills.map((skill) => {
        const parentRows = skill.requiredSkillIds
          .map((req) => rowAssignment[req])
          .filter((r) => r !== undefined);
        const bary = parentRows.length
          ? parentRows.reduce((a, b) => a + b, 0) / parentRows.length
          : Infinity; // No parents yet => push to bottom later
        return { skill, bary };
      });

      // Sort by barycenter (Infinity last), then alphabetically for stability.
      withBary.sort((a, b) => {
        if (a.bary === b.bary) return a.skill.name.localeCompare(b.skill.name);
        if (a.bary === Infinity) return 1;
        if (b.bary === Infinity) return -1;
        return a.bary - b.bary;
      });

      // Place skills in the determined order.
      withBary.forEach(({ skill, bary }) => {
        // Desired row = rounded barycenter or next available below existing rows.
        const occupied = rowsUsedByTier[tier] ?? new Set<number>();
        const currentMaxRow = occupied.size ? Math.max(...occupied) : -1;
        const desired = Number.isFinite(bary) ? Math.round(bary) : currentMaxRow + 1;
        const finalRow = getNearestFreeRow(tier, Math.max(0, desired));
        pushNode(skill, tier, finalRow);
      });
    });

    setSkillNodes(nodes);
  }, [filteredSkills, activatedSkillIds, ownedSkillIds, userSkillPoints, adminMode]);

  const handleSkillClick = (skill: SkillNode, e: React.MouseEvent) => {
    // Prevent click during drag
    if (isDragging) {
      e.stopPropagation();
      return;
    }

    if (adminMode) {
      router.push(`/manual/skillTree/edit/${skill.id}`);
    } else {
      setSelectedSkill(skill);
      setIsModalOpen(true);
    }
  };

  const handlePurchase = (skillId: string) => {
    onPurchaseSkill?.(skillId);
    setSelectedSkill(null);
    setIsModalOpen(false);
  };

  // Mouse event handlers for panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left mouse button
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanPoint({ x: transform.x, y: transform.y });
      e.preventDefault();
    },
    [transform],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      setTransform((prev) => ({
        ...prev,
        x: lastPanPoint.x + deltaX,
        y: lastPanPoint.y + deltaY,
      }));
    },
    [isDragging, dragStart, lastPanPoint],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Wheel event for zooming
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(3, transform.scale * zoomFactor));

      if (!svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Zoom toward mouse position
      const dx = (mouseX - transform.x) / transform.scale;
      const dy = (mouseY - transform.y) / transform.scale;

      setTransform((_prev) => ({
        scale: newScale,
        x: mouseX - dx * newScale,
        y: mouseY - dy * newScale,
      }));
    },
    [transform],
  );

  // Calculate content bounds
  const getContentBounds = useCallback(() => {
    if (!skillNodes.length) return { minX: 0, minY: 0, maxX: 800, maxY: 400 };

    const minX = Math.min(...skillNodes.map((n) => n.x)) - 30;
    const minY = Math.min(...skillNodes.map((n) => n.y)) - 0;
    const maxX = Math.max(...skillNodes.map((n) => n.x + 200)) + 30;
    const maxY = Math.max(...skillNodes.map((n) => n.y + 100)) + 100;

    return { minX, minY, maxX, maxY };
  }, [skillNodes]);

  // Fit view to show all content
  const fitToView = useCallback(() => {
    if (!containerRef.current || !skillNodes.length) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const { minX, minY, maxX, maxY } = getContentBounds();

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    // Calculate scale to fit content with minimal padding
    const scaleX = (containerWidth - 5) / contentWidth;
    const scaleY = (containerHeight - 5) / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1.0); // Do not upscale beyond 1

    // Center the content
    const scaledWidth = contentWidth * scale;
    const scaledHeight = contentHeight * scale;
    const offsetX = (containerWidth - scaledWidth) / 2 - minX * scale;
    const offsetY = (containerHeight - scaledHeight) / 2 - minY * scale;

    // Dynamically resize the container to fit the entire tree vertically
    if (containerRef.current) {
      // Add a tiny margin so the bottom nodes aren't cut off
      containerRef.current.style.height = `${Math.ceil(scaledHeight + 20)}px`;
    }

    setTransform({ x: offsetX, y: offsetY, scale });
  }, [skillNodes, getContentBounds]);

  // Auto-fit (and size container) when skill nodes are first ready or change
  useEffect(() => {
    if (skillNodes.length === 0) return;

    // Run once immediately (synchronous update after mount)
    fitToView();

    // Run again shortly after to account for any late-rendered DOM sizing
    const timer = setTimeout(fitToView, 100);
    return () => clearTimeout(timer);
  }, [skillNodes, fitToView]);

  // Reset zoom and pan (now uses fit-to-view)
  const resetView = useCallback(() => {
    fitToView();
  }, [fitToView]);

  // Recenter view whenever the category filter changes
  useEffect(() => {
    if (containerRef.current) {
      // Allow container to shrink before recalculating
      containerRef.current.style.height = "auto";
    }
    resetView();
  }, [selectedCategories, resetView]);

  // Zoom in function
  const zoomIn = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(3, prev.scale * 1.2),
    }));
  }, []);

  // Zoom out function
  const zoomOut = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.1, prev.scale * 0.8),
    }));
  }, []);

  // SVG dimensions - make them tightly bound to content
  const { minX, minY, maxX, maxY } = getContentBounds();
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const svgWidth = Math.max(800, contentWidth + 100); // Increased minimum width for filtered views
  const svgHeight = Math.max(600, contentHeight - 50); // Increased minimum height for filtered views

  return (
    <TooltipProvider>
      <div className="w-full">
        {/* Controls */}
        <div className="mb-2 flex gap-2 items-center">
          <Button variant="outline" onClick={resetView}>
            Fit to View
          </Button>
          <Button variant="outline" onClick={zoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={zoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="grow"></div>
          <div className="ml-5 w-40 max-w-40 ">
            <MultiSelect
              options={allEffectTypes.map<OptionType>((t) => ({ label: t, value: t }))}
              selected={selectedCategories}
              onChange={setSelectedCategories}
              placeholder="Filter"
            />
          </div>
        </div>

        {/* Category Filters */}

        <div
          ref={containerRef}
          className="overflow-hidden border rounded-lg bg-popover cursor-move"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          <svg ref={svgRef} width={svgWidth} height={svgHeight} className="w-full">
            <g
              transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
            >
              {/* Draw connections between prerequisites */}
              {skillNodes.map((skill) =>
                skill.requiredSkillIds.map((reqId) => {
                  const prereqSkill = skillNodes.find((s) => s.id === reqId);
                  if (!prereqSkill) return null;

                  const startX = prereqSkill.x + 100; // Center of 200px wide node (reduced from 120)
                  const startY = prereqSkill.y + 100; // Center of 200px tall node (reduced from 120)
                  const endX = skill.x + 100;
                  const endY = skill.y + 100;

                  return (
                    <line
                      key={`${reqId}-${skill.id}`}
                      x1={startX}
                      y1={startY}
                      x2={endX}
                      y2={endY}
                      stroke="currentColor"
                      strokeWidth="2"
                      markerEnd="url(#arrowhead)"
                      className="text-border"
                    />
                  );
                }),
              )}

              {/* Definitions */}
              <defs>
                {/* Arrow marker */}
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    fill="currentColor"
                    className="text-border"
                  />
                </marker>

                {/* Image patterns for skills */}
                {skillNodes.map((skill) => (
                  <pattern
                    key={skill.id}
                    id={`skillImage-${skill.id}`}
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                  >
                    <image
                      href={skill.image}
                      x="0"
                      y="0"
                      width="64"
                      height="64"
                      preserveAspectRatio="xMidYMid slice"
                    />
                  </pattern>
                ))}
              </defs>

              {/* Draw skill nodes */}
              {skillNodes.map((skill) => {
                const centerX = skill.x + 100;
                const centerY = skill.y + 100;
                const badgeRadius = 20;

                // Determine skill status for styling
                // Treat unactivated skills as if they're not owned
                const effectivelyOwned = skill.isOwned && skill.isActivated;
                const isLocked = !effectivelyOwned && !skill.hasPrereqs;
                const isUnaffordable =
                  !effectivelyOwned && skill.hasPrereqs && !skill.hasPoints;
                const isAvailable =
                  !effectivelyOwned && skill.hasPrereqs && skill.hasPoints;

                return (
                  <g
                    key={skill.id}
                    className={skill.hidden && adminMode ? "opacity-50" : ""}
                  >
                    {/* Background circle */}
                    <circle
                      cx={centerX}
                      cy={centerY}
                      r="64"
                      className={`
                        cursor-pointer transition-all duration-200
                        ${
                          effectivelyOwned
                            ? "fill-green-500/10 stroke-green-500 stroke-[3] dark:fill-green-500/20"
                            : isAvailable
                              ? "fill-blue-500/10 stroke-blue-500 stroke-[3] dark:fill-blue-500/20"
                              : isUnaffordable
                                ? "fill-red-500/10 stroke-red-500 stroke-[3] dark:fill-red-500/20"
                                : "fill-muted stroke-border stroke-[3]"
                        }
                      `}
                      onClick={(e) => handleSkillClick(skill, e)}
                    />

                    {/* Skill image clipped to circle so it fills perfectly */}
                    <defs>
                      <clipPath id={`skillClip-${skill.id}`}>
                        {/* Use slightly larger radius so image meets the outer stroke */}
                        <circle cx={centerX} cy={centerY} r="60" />{" "}
                        {/* Reduced from 72 */}
                      </clipPath>
                    </defs>

                    <image
                      href={skill.image}
                      x={centerX - 64}
                      y={centerY - 64}
                      width="128"
                      height="128"
                      clipPath={`url(#skillClip-${skill.id})`}
                      preserveAspectRatio="xMidYMid slice"
                      className={`transition-all duration-200 ${
                        isLocked || isUnaffordable ? "opacity-60" : ""
                      }`}
                      style={{
                        filter: isLocked || isUnaffordable ? "grayscale(100%)" : "none",
                        pointerEvents: "none",
                      }}
                    />

                    {/* Tier badge */}
                    <circle
                      cx={centerX - 50}
                      cy={centerY - 50}
                      r={badgeRadius}
                      className="fill-slate-700 dark:fill-slate-300 stroke-card stroke-2"
                    />
                    <text
                      x={centerX - 50}
                      y={centerY - 45} // Adjusted for proper vertical centering
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-white dark:fill-slate-800 text-2xl font-bold pointer-events-none"
                    >
                      {skill.tier}
                    </text>

                    {/* Cost badge */}
                    <circle
                      cx={centerX + 50}
                      cy={centerY - 50}
                      r={badgeRadius}
                      className="fill-yellow-500 dark:fill-yellow-400 stroke-card stroke-2"
                    />
                    <text
                      x={centerX + 50}
                      y={centerY - 45} // Adjusted for proper vertical centering
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-white dark:fill-slate-900 text-2xl font-bold pointer-events-none"
                    >
                      {skill.costSkillPoints}
                    </text>

                    {/* Status icon */}
                    {!adminMode && effectivelyOwned && (
                      <foreignObject
                        x={centerX + 50 - badgeRadius}
                        y={centerY + 50 - badgeRadius}
                        width={badgeRadius * 2}
                        height={badgeRadius * 2}
                        className="pointer-events-none"
                      >
                        <Check className="w-full h-full p-0.5 text-white bg-green-500 border-2 border-card rounded-full" />
                      </foreignObject>
                    )}

                    {!adminMode && isLocked && (
                      <foreignObject
                        x={centerX + 50 - badgeRadius}
                        y={centerY + 50 - badgeRadius}
                        width={badgeRadius * 2}
                        height={badgeRadius * 2}
                        className="pointer-events-none"
                      >
                        <Lock className="w-full h-full p-1.5 text-white bg-muted-foreground border-2 border-card rounded-full" />
                      </foreignObject>
                    )}

                    {!adminMode && isUnaffordable && (
                      <foreignObject
                        x={centerX + 50 - badgeRadius}
                        y={centerY + 50 - badgeRadius}
                        width={badgeRadius * 2}
                        height={badgeRadius * 2}
                        className="pointer-events-none"
                      >
                        <X className="w-full h-full p-0.5 text-white bg-red-500 border-2 border-card rounded-full" />
                      </foreignObject>
                    )}

                    {/* Skill name (below the node) */}
                    <text
                      x={centerX}
                      y={centerY + 100}
                      textAnchor="middle"
                      className="text-xl font-medium fill-foreground pointer-events-none"
                    >
                      {skill.name}
                    </text>

                    {adminMode && (
                      <text
                        x={centerX}
                        y={centerY + 150} // Adjusted from 170
                        textAnchor="middle"
                        className="text-lg fill-muted-foreground pointer-events-none"
                      >
                        {skill.hidden ? "Hidden" : "Visible"}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Skill details modal */}
        {selectedSkill && !adminMode && (
          <Modal2
            title={selectedSkill.name}
            isOpen={isModalOpen}
            setIsOpen={setIsModalOpen}
            proceed_label={
              selectedSkill.isOwned && selectedSkill.isActivated
                ? null
                : selectedSkill.canPurchase
                  ? `Purchase for ${selectedSkill.costSkillPoints} SP`
                  : null
            }
            onAccept={
              selectedSkill.canPurchase
                ? () => handlePurchase(selectedSkill.id)
                : undefined
            }
            onClose={() => {
              setSelectedSkill(null);
              setIsModalOpen(false);
            }}
          >
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Tier {selectedSkill.tier}</Badge>
                {selectedSkill.isOwned && selectedSkill.isActivated && (
                  <Badge className="flex items-center gap-1 bg-green-100 text-green-800">
                    <Check className="w-3 h-3" />
                    Activated
                  </Badge>
                )}
                {selectedSkill.isOwned && !selectedSkill.isActivated && (
                  <Badge className="flex items-center gap-1 bg-yellow-100 text-yellow-800">
                    <Lock className="w-3 h-3" />
                    Owned (Inactive)
                  </Badge>
                )}
              </div>

              <div
                className="text-sm text-gray-600"
                dangerouslySetInnerHTML={{ __html: selectedSkill.description }}
              />

              <div className="text-sm">
                <strong>Cost:</strong> {selectedSkill.costSkillPoints} Skill Points
              </div>

              {selectedSkill.requiredSkillIds.length > 0 && (
                <div className="text-sm">
                  <strong>Prerequisites:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {selectedSkill.requiredSkillIds.map((reqId) => {
                      const prereq = skillNodes.find((s) => s.id === reqId);
                      const isPrereqActivated = activatedSkillIds.includes(reqId);
                      return (
                        <li
                          key={reqId}
                          className={
                            isPrereqActivated ? "text-green-600" : "text-gray-600"
                          }
                        >
                          {prereq?.name || reqId} {isPrereqActivated ? "✓" : "✗"}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {!selectedSkill.isOwned &&
                !selectedSkill.isActivated &&
                !selectedSkill.canPurchase && (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {userSkillPoints < selectedSkill.costSkillPoints
                        ? "Not enough skill points"
                        : "Prerequisites not met"}
                    </span>
                  </div>
                )}
            </div>
          </Modal2>
        )}

        {/* Legend */}
        {!adminMode && (
          <div className="mt-4 flex flex-wrap gap-6 text-sm text-foreground">
            <div className="flex items-center gap-2">
              <Check className="w-7 h-7 p-1 text-white bg-green-500 border-2 border-green-500 rounded-full" />
              <span>Owned</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-blue-500/10 dark:bg-blue-500/20 border-2 border-blue-500 rounded-full"></div>
              <span>Available</span>
            </div>
            <div className="flex items-center gap-2">
              <X className="w-7 h-7 p-1 text-white bg-red-500 border-2 border-red-500 rounded-full" />
              <span>Can&apos;t Afford</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="w-7 h-7 p-1 text-white bg-muted-foreground border-2 border-muted-foreground rounded-full" />
              <span>Locked</span>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
