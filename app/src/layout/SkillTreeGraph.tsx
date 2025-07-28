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

    // Calculate layout - positioning tier 2 skills next to their tier 1 prerequisites
    const tierWidth = 300; // Space between columns
    const skillHeight = 240; // Space between skills in a column
    const padding = 60;

    // First, position all tier 1 skills
    const tier1Skills = skillsByTier[1] || [];
    const tier1Positions: Record<string, { x: number; y: number }> = {};

    tier1Skills.forEach((skill, skillIndex) => {
      const x = padding + 150;
      const y = skillIndex * skillHeight + padding;
      
      tier1Positions[skill.id] = { x, y };
      
      // Check if skill can be purchased
      const isOwned = userSkillIds.includes(skill.id);
      const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
        userSkillIds.includes(reqId),
      );
      const hasPoints = userSkillPoints >= skill.costSkillPoints;
      const canPurchase = !isOwned && hasPrereqs && hasPoints && !adminMode;

      nodes.push({
        ...skill,
        x,
        y,
        tier: 1,
        canPurchase,
        isOwned,
        hasPrereqs,
        hasPoints,
      });
    });

    // Then position tier 2 skills next to their tier 1 prerequisites
    const tier2Skills = skillsByTier[2] || [];
    const tier2WithPrereqs: SkillTree[] = [];
    const tier2WithoutPrereqs: SkillTree[] = [];
    
    // Separate tier 2 skills into those with and without tier 1 prerequisites
    tier2Skills.forEach((skill) => {
      const hasTier1Prereq = skill.requiredSkillIds.some(reqId => 
        tier1Positions[reqId]
      );
      
      if (hasTier1Prereq) {
        tier2WithPrereqs.push(skill);
      } else {
        tier2WithoutPrereqs.push(skill);
      }
    });
    
    // Position tier 2 skills with tier 1 prerequisites next to their prereqs
    tier2WithPrereqs.forEach((skill) => {
      // Find the tier 1 prerequisite
      const tier1Prereq = skill.requiredSkillIds.find(reqId => 
        tier1Positions[reqId]
      );
      
      if (tier1Prereq && tier1Positions[tier1Prereq]) {
        // Position next to the tier 1 prerequisite
        const x = tier1Positions[tier1Prereq].x + tierWidth;
        const y = tier1Positions[tier1Prereq].y;

        // Check if skill can be purchased
        const isOwned = userSkillIds.includes(skill.id);
        const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
          userSkillIds.includes(reqId),
        );
        const hasPoints = userSkillPoints >= skill.costSkillPoints;
        const canPurchase = !isOwned && hasPrereqs && hasPoints && !adminMode;

        nodes.push({
          ...skill,
          x,
          y,
          tier: 2,
          canPurchase,
          isOwned,
          hasPrereqs,
          hasPoints,
        });
      }
    });
    
    // Position tier 2 skills without tier 1 prerequisites at the bottom of second column
    tier2WithoutPrereqs.forEach((skill, skillIndex) => {
      const x = padding + 150 + tierWidth;
      const y = (tier1Skills.length + skillIndex) * skillHeight + padding;

      // Check if skill can be purchased
      const isOwned = userSkillIds.includes(skill.id);
      const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
        userSkillIds.includes(reqId),
      );
      const hasPoints = userSkillPoints >= skill.costSkillPoints;
      const canPurchase = !isOwned && hasPrereqs && hasPoints && !adminMode;

      nodes.push({
        ...skill,
        x,
        y,
        tier: 2,
        canPurchase,
        isOwned,
        hasPrereqs,
        hasPoints,
      });
    });

    // Position remaining tiers in subsequent columns
    tiers.slice(2).forEach((tier, tierIndex) => {
      const tierSkills = skillsByTier[tier];
      if (!tierSkills) return;

      const tierX = (tierIndex + 2) * tierWidth + padding + 150;

      // Separate skills into those with and without prerequisites from previous tiers
      const tierWithPrereqs: SkillTree[] = [];
      const tierWithoutPrereqs: SkillTree[] = [];
      
      tierSkills.forEach((skill) => {
        const hasPrereqFromPrevTiers = skill.requiredSkillIds.some(reqId => {
          // Check if any prerequisite is from a previous tier
          const prereqSkill = filteredSkills.find(s => s.id === reqId);
          return prereqSkill && prereqSkill.tier < tier;
        });
        
        if (hasPrereqFromPrevTiers) {
          tierWithPrereqs.push(skill);
        } else {
          tierWithoutPrereqs.push(skill);
        }
      });
      
      // Position skills with prerequisites from previous tiers next to their prereqs
      tierWithPrereqs.forEach((skill) => {
        // Find the prerequisite from previous tiers
        const prereqFromPrevTier = skill.requiredSkillIds.find(reqId => {
          const prereqSkill = filteredSkills.find(s => s.id === reqId);
          return prereqSkill && prereqSkill.tier < tier;
        });
        
        if (prereqFromPrevTier) {
          const prereqNode = nodes.find(n => n.id === prereqFromPrevTier);
          if (prereqNode) {
            // Position next to the prerequisite
            const x = prereqNode.x + tierWidth;
            const y = prereqNode.y;

            // Check if skill can be purchased
            const isOwned = userSkillIds.includes(skill.id);
            const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
              userSkillIds.includes(reqId),
            );
            const hasPoints = userSkillPoints >= skill.costSkillPoints;
            const canPurchase = !isOwned && hasPrereqs && hasPoints && !adminMode;

            nodes.push({
              ...skill,
              x,
              y,
              tier,
              canPurchase,
              isOwned,
              hasPrereqs,
              hasPoints,
            });
          }
        }
      });
      
      // Position skills without prerequisites from previous tiers at the bottom of their column
      tierWithoutPrereqs.forEach((skill, skillIndex) => {
        // Calculate the bottom position based on all previous tiers
        let bottomY = 0;
        for (let i = 1; i < tier; i++) {
          const prevTierSkills = skillsByTier[i] || [];
          bottomY = Math.max(bottomY, prevTierSkills.length * skillHeight + padding);
        }
        
        const x = tierX;
        const y = bottomY + skillIndex * skillHeight + padding;

        // Check if skill can be purchased
        const isOwned = userSkillIds.includes(skill.id);
        const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
          userSkillIds.includes(reqId),
        );
        const hasPoints = userSkillPoints >= skill.costSkillPoints;
        const canPurchase = !isOwned && hasPrereqs && hasPoints && !adminMode;

        nodes.push({
          ...skill,
          x,
          y,
          tier,
          canPurchase,
          isOwned,
          hasPrereqs,
          hasPoints,
        });
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
    const maxX = Math.max(...skillNodes.map((n) => n.x + 200)) + 60; // 200 is node width (reduced from 240)
    const maxY = Math.max(...skillNodes.map((n) => n.y + 240)) + 60; // 240 is node height (increased from 240)

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
                const centerX = skill.x + 100; // Reduced from 120
                const centerY = skill.y + 100; // Reduced from 120
                const badgeRadius = 20; // Reduced from 24

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
                      r="64" // Reduced from 76
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
                        <circle cx={centerX} cy={centerY} r="60" /> {/* Reduced from 72 */}
                      </clipPath>
                    </defs>

                    <image
                      href={skill.image}
                      x={centerX - 64} // Reduced from 80
                      y={centerY - 64} // Reduced from 80
                      width="128" // Reduced from 160
                      height="128" // Reduced from 160
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
                      cx={centerX - 50} // Reduced from 60
                      cy={centerY - 50} // Reduced from 60
                      r={badgeRadius}
                      className="fill-slate-700 dark:fill-slate-300 stroke-card stroke-2"
                    />
                    <text
                      x={centerX - 50} // Reduced from 60
                      y={centerY - 35} // Adjusted from 45
                      textAnchor="middle"
                      className="fill-white dark:fill-slate-800 text-2xl font-bold pointer-events-none" // Reduced from text-3xl
                    >
                      {skill.tier}
                    </text>

                    {/* Cost badge */}
                    <circle
                      cx={centerX + 50} // Reduced from 60
                      cy={centerY - 50} // Reduced from 60
                      r={badgeRadius}
                      className="fill-yellow-500 dark:fill-yellow-400 stroke-card stroke-2"
                    />
                    <text
                      x={centerX + 50} // Reduced from 60
                      y={centerY - 35} // Adjusted from 45
                      textAnchor="middle"
                      className="fill-white dark:fill-slate-900 text-2xl font-bold pointer-events-none" // Reduced from text-3xl
                    >
                      {skill.costSkillPoints}
                    </text>

                    {/* Status icon */}
                    {!adminMode && skill.isOwned && (
                      <foreignObject
                        x={centerX + 50 - badgeRadius} // Reduced from 60
                        y={centerY + 50 - badgeRadius} // Reduced from 60
                        width={badgeRadius * 2}
                        height={badgeRadius * 2}
                        className="pointer-events-none"
                      >
                        <Check className="w-full h-full p-0.5 text-white bg-green-500 border-2 border-card rounded-full" />
                      </foreignObject>
                    )}

                    {!adminMode && isLocked && (
                      <foreignObject
                        x={centerX + 50 - badgeRadius} // Reduced from 60
                        y={centerY + 50 - badgeRadius} // Reduced from 60
                        width={badgeRadius * 2}
                        height={badgeRadius * 2}
                        className="pointer-events-none"
                      >
                        <Lock className="w-full h-full p-1.5 text-white bg-muted-foreground border-2 border-card rounded-full" />
                      </foreignObject>
                    )}

                    {!adminMode && isUnaffordable && (
                      <foreignObject
                        x={centerX + 50 - badgeRadius} // Reduced from 60
                        y={centerY + 50 - badgeRadius} // Reduced from 60
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
                      y={centerY + 120} // Adjusted from 140
                      textAnchor="middle"
                      className="text-xl font-medium fill-foreground pointer-events-none" // Reduced from text-2xl
                    >
                      {skill.name}
                    </text>

                    {adminMode && (
                      <text
                        x={centerX}
                        y={centerY + 150} // Adjusted from 170
                        textAnchor="middle"
                        className="text-lg fill-muted-foreground pointer-events-none" // Reduced from text-xl
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
