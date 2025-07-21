"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Check, Lock, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRouter } from "next/navigation";
import Modal2 from "@/layout/Modal2";
import type { SkillTree } from "@/drizzle/schema";

interface SkillTreeGraphProps {
  skills: SkillTree[];
  userSkillIds?: string[];
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
  hasPrereqs: boolean;
  hasPoints: boolean;
}

export default function SkillTreeGraph({
  skills,
  userSkillIds = [],
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Viewport state for panning and zooming
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });

  // Get all unique effect types from skills
  const allEffectTypes = Array.from(new Set(skills.flatMap(skill => 
    skill.effects?.map(effect => effect.type) || []
  ))).sort();
  
  // Filter skills based on selected category
  const filteredSkills = selectedCategory 
    ? skills.filter(skill => skill.effects?.some(effect => effect.type === selectedCategory))
    : skills;

  // Layout skills in a tree structure
  useEffect(() => {
    if (!filteredSkills.length) return;

    // Group skills by tier
    const skillsByTier = filteredSkills.reduce(
      (acc, skill) => {
        if (!acc[skill.tier]) acc[skill.tier] = [];
        acc[skill.tier]!.push(skill);
        return acc;
      },
      {} as Record<number, SkillTree[]>,
    );

    const tiers = Object.keys(skillsByTier)
      .map(Number)
      .sort((a, b) => a - b);
    const nodes: SkillNode[] = [];

    // Calculate layout - using circular nodes now
    const tierWidth = 300; // Doubled from 150
    const skillHeight = 320; // Increased from 240 to accommodate larger text
    const padding = 60; // Doubled from 30

    // 1) Track x-positions of skills that have already been laid out so later tiers
    //    can reference their prerequisite positions.
    const prevTierX: Record<string, number> = {};

    // 2) Build a map of how many other skills depend on a given skill.  This will
    //    let us push completely isolated skills (no prereqs, no dependents) to
    //    the end of a tier, reducing edge crossings.
    const dependentsCount: Record<string, number> = {};
    filteredSkills.forEach((s) => {
      s.requiredSkillIds.forEach((reqId) => {
        dependentsCount[reqId] = (dependentsCount[reqId] || 0) + 1;
      });
    });

    tiers.forEach((tier, tierIndex) => {
      const tierSkills = skillsByTier[tier];
      if (!tierSkills) return;

      // Vertical position of this tier
      const tierY = tierIndex * (skillHeight + 80) + padding;

      // Sort the skills inside this tier.  The sort key is the average x-position
      // of its prerequisites (if any) that have already been positioned.  This
      // tends to place a child directly below / above its parent(s) and thus
      // reduces edge crossings.  Skills with no prerequisites fall back to
      // their original order.
      const sortedTierSkills = tierSkills.slice().sort((a, b) => {
        const avgPos = (skill: SkillTree) => {
          const prereqXs = skill.requiredSkillIds
            .map((id) => prevTierX[id])
            .filter((x): x is number => x !== undefined);
          if (prereqXs.length === 0) return Number.POSITIVE_INFINITY;
          return prereqXs.reduce((sum, x) => sum + x, 0) / prereqXs.length;
        };

        const aAvg = avgPos(a);
        const bAvg = avgPos(b);

        // Prefer skills with finite average (i.e. those with positioned parents)
        const aFinite = Number.isFinite(aAvg);
        const bFinite = Number.isFinite(bAvg);

        if (aFinite && bFinite) return aAvg - bAvg;
        if (aFinite) return -1;
        if (bFinite) return 1;

        // Both averages are Infinity => neither has prerequisites already placed.
        // Use dependents count so parent-like nodes come first; isolated nodes last.
        const depA = dependentsCount[a.id] || 0;
        const depB = dependentsCount[b.id] || 0;
        if (depA !== depB) return depB - depA; // more dependents earlier

        return 0; // fallback to original order if all else equal
      });

      sortedTierSkills.forEach((skill, skillIndex) => {
        // Basic horizontal spacing – the *order* comes from the sort above
        const skillX = skillIndex * tierWidth + padding + 150;

        // Check if skill can be purchased
        const isOwned = userSkillIds.includes(skill.id);
        const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
          userSkillIds.includes(reqId),
        );
        const hasPoints = userSkillPoints >= skill.costSkillPoints;
        const canPurchase = !isOwned && hasPrereqs && hasPoints && !adminMode;

        nodes.push({
          ...skill,
          x: skillX,
          y: tierY,
          tier,
          canPurchase,
          isOwned,
          hasPrereqs,
          hasPoints,
        });

        // Store the x-position so deeper tiers can align with it
        prevTierX[skill.id] = skillX;
      });
    });

    setSkillNodes(nodes);
  }, [filteredSkills, userSkillIds, userSkillPoints, adminMode]);

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

    const minX = Math.min(...skillNodes.map((n) => n.x)) - 60; // Doubled from 30
    const minY = Math.min(...skillNodes.map((n) => n.y)) - 60; // Doubled from 30
    const maxX = Math.max(...skillNodes.map((n) => n.x + 240)) + 60; // 240 is node width (doubled from 120)
    const maxY = Math.max(...skillNodes.map((n) => n.y + 320)) + 60; // 320 is node height (increased from 240)

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

    // Calculate scale to fit content with some padding
    const scaleX = (containerWidth - 40) / contentWidth;
    const scaleY = (containerHeight - 40) / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 1x

    // Center the content
    const scaledWidth = contentWidth * scale;
    const scaledHeight = contentHeight * scale;
    const offsetX = (containerWidth - scaledWidth) / 2 - minX * scale;
    const offsetY = (containerHeight - scaledHeight) / 2 - minY * scale;

    setTransform({ x: offsetX, y: offsetY, scale });
  }, [skillNodes, getContentBounds]);

  // Auto-fit when skill nodes change
  useEffect(() => {
    if (skillNodes.length > 0) {
      // Small delay to ensure container is rendered
      const timer = setTimeout(fitToView, 100);
      return () => clearTimeout(timer);
    }
  }, [skillNodes, fitToView]);

  // Reset zoom and pan (now uses fit-to-view)
  const resetView = useCallback(() => {
    fitToView();
  }, [fitToView]);

  // Zoom in function
  const zoomIn = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.min(3, prev.scale * 1.2)
    }));
  }, []);

  // Zoom out function
  const zoomOut = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.1, prev.scale * 0.8)
    }));
  }, []);

  // SVG dimensions
  const { maxX, maxY } = getContentBounds();
  const svgWidth = Math.max(800, maxX + 100);
  const svgHeight = Math.max(400, maxY + 100);

  return (
    <TooltipProvider>
      <div className="w-full">
        {/* Controls */}
        <div className="mb-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={resetView}>
            Fit to View
          </Button>
          <Button size="sm" variant="outline" onClick={zoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={zoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="text-sm text-muted-foreground flex items-center">
            Drag to pan • Scroll to zoom
          </div>
        </div>

        {/* Category Filters */}
        <div className="mb-4">
          <div className="flex flex-wrap gap-2 mb-2">
            <Button
              size="sm"
              variant={selectedCategory === null ? "default" : "outline"}
              onClick={() => setSelectedCategory(null)}
            >
              All Skills
            </Button>
            {allEffectTypes.map((effectType) => (
              <Button
                key={effectType}
                size="sm"
                variant={selectedCategory === effectType ? "default" : "outline"}
                onClick={() => setSelectedCategory(effectType)}
              >
                {effectType}
              </Button>
            ))}
          </div>
          {selectedCategory && (
            <div className="text-sm text-muted-foreground">
              Showing skills with {selectedCategory} effects ({filteredSkills.length} skills)
            </div>
          )}
        </div>

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

                  const startX = prereqSkill.x + 120; // Center of 240px wide node (doubled from 60)
                  const startY = prereqSkill.y + 120; // Center of 240px tall node (doubled from 60)
                  const endX = skill.x + 120;
                  const endY = skill.y + 120;

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
                const centerX = skill.x + 120; // Doubled from 60
                const centerY = skill.y + 120; // Doubled from 60
                const badgeRadius = 24; // Doubled from 12

                // Determine skill status for styling
                const isLocked = !skill.isOwned && !skill.hasPrereqs;
                const isUnaffordable =
                  !skill.isOwned && skill.hasPrereqs && !skill.hasPoints;
                const isAvailable =
                  !skill.isOwned && skill.hasPrereqs && skill.hasPoints;

                return (
                  <g
                    key={skill.id}
                    className={skill.hidden && adminMode ? "opacity-50" : ""}
                  >
                    {/* Background circle */}
                    <circle
                      cx={centerX}
                      cy={centerY}
                      r="76" // Doubled from 38
                      className={`
                        cursor-pointer transition-all duration-200
                        ${
                          skill.isOwned
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
                        <circle cx={centerX} cy={centerY} r="72" /> {/* Doubled from 36 */}
                      </clipPath>
                    </defs>

                    <image
                      href={skill.image}
                      x={centerX - 80} // Doubled from 40
                      y={centerY - 80} // Doubled from 40
                      width="160" // Doubled from 80
                      height="160" // Doubled from 80
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
                      cx={centerX - 60} // Doubled from 30
                      cy={centerY - 60} // Doubled from 30
                      r={badgeRadius}
                      className="fill-slate-700 dark:fill-slate-300 stroke-card stroke-2"
                    />
                    <text
                      x={centerX - 60} // Doubled from 30
                      y={centerY - 45} // Adjusted to prevent cutoff
                      textAnchor="middle"
                      className="fill-white dark:fill-slate-800 text-3xl font-bold pointer-events-none" // Increased from text-2xl
                    >
                      {skill.tier}
                    </text>

                    {/* Cost badge */}
                    <circle
                      cx={centerX + 60} // Doubled from 30
                      cy={centerY - 60} // Doubled from 30
                      r={badgeRadius}
                      className="fill-yellow-500 dark:fill-yellow-400 stroke-card stroke-2"
                    />
                    <text
                      x={centerX + 60} // Doubled from 30
                      y={centerY - 45} // Adjusted to prevent cutoff
                      textAnchor="middle"
                      className="fill-white dark:fill-slate-900 text-3xl font-bold pointer-events-none" // Increased from text-2xl
                    >
                      {skill.costSkillPoints}
                    </text>

                    {/* Status icon */}
                    {!adminMode && skill.isOwned && (
                      <foreignObject
                        x={centerX + 60 - badgeRadius} // Doubled from 30
                        y={centerY + 60 - badgeRadius} // Doubled from 30
                        width={badgeRadius * 2}
                        height={badgeRadius * 2}
                        className="pointer-events-none"
                      >
                        <Check className="w-full h-full p-0.5 text-white bg-green-500 border-2 border-card rounded-full" />
                      </foreignObject>
                    )}

                    {!adminMode && isLocked && (
                      <foreignObject
                        x={centerX + 60 - badgeRadius} // Doubled from 30
                        y={centerY + 60 - badgeRadius} // Doubled from 30
                        width={badgeRadius * 2}
                        height={badgeRadius * 2}
                        className="pointer-events-none"
                      >
                        <Lock className="w-full h-full p-1.5 text-white bg-muted-foreground border-2 border-card rounded-full" />
                      </foreignObject>
                    )}

                    {!adminMode && isUnaffordable && (
                      <foreignObject
                        x={centerX + 60 - badgeRadius} // Doubled from 30
                        y={centerY + 60 - badgeRadius} // Doubled from 30
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
                      y={centerY + 140} // Increased from 110 to give more space
                      textAnchor="middle"
                      className="text-2xl font-medium fill-foreground pointer-events-none" // Increased from text-xl
                    >
                      {skill.name}
                    </text>

                    {adminMode && (
                      <text
                        x={centerX}
                        y={centerY + 170} // Increased from 140 to give more space
                        textAnchor="middle"
                        className="text-xl fill-muted-foreground pointer-events-none" // Increased from text-lg
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
              selectedSkill.isOwned
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
                {selectedSkill.isOwned && (
                  <Badge className="flex items-center gap-1 bg-green-100 text-green-800">
                    <Check className="w-3 h-3" />
                    Owned
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
                      return (
                        <li key={reqId} className="text-gray-600">
                          {prereq?.name || reqId}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {!selectedSkill.isOwned && !selectedSkill.canPurchase && (
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
