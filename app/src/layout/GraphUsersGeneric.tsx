"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Cytoscape from "cytoscape";
import edgehandles from "cytoscape-edgehandles";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { isMobile } from "@/utils/audio";
import { parseStackFrames } from "@/utils/error";
import { getSearchValidator } from "@/validators/register";

// Register edgehandles extension once globally
Cytoscape.use(edgehandles);

interface GraphUsersGenericProps {
  hideDefault?: boolean;
  nodes: { id: string; label: string; img: string | null }[];
  edges: {
    source: string;
    target: string;
    label: string;
    weight: number;
  }[];
}
const GraphUsersGeneric = (
  props: GraphUsersGenericProps,
): React.ReactElement | null => {
  // State
  const localTheme = safeLocalStorageGetItem("theme");
  const cyRef = useRef<Cytoscape.Core | null>(null);
  const isMountedRef = useRef(true);
  const layoutRunningRef = useRef(false);
  const layoutInstanceRef = useRef<Cytoscape.Layouts | null>(null);
  const isMobileDevice = isMobile();
  const color = localTheme === "dark" ? "white" : "black";

  // Extract stop logic to useCallback to avoid side effects in render
  const stopLayout = useCallback(() => {
    if (layoutRunningRef.current && layoutInstanceRef.current) {
      try {
        layoutInstanceRef.current.stop();
        layoutRunningRef.current = false;
        layoutInstanceRef.current = null;
      } catch (e) {
        if (e instanceof Error) {
          // Only suppress the known "already stopped" error from cytoscape
          if (isCytoscapeError(e, "already stopped")) {
            return; // Silently ignore expected error
          }
          // Log all other errors - these are unexpected
          console.warn("Unexpected error stopping layout:", e);
        }
      }
    }
  }, []);

  // Cleanup cytoscape instance on unmount to prevent touch event race conditions
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (cyRef.current) {
        const cyRefInstance = cyRef.current;
        cyRef.current = null;

        // Stop any running layout first using the extracted function
        stopLayout();

        // Disable all user interactions immediately to prevent new touch events
        cyRefInstance.autoungrabify(true);
        cyRefInstance.autounselectify(true);
        cyRefInstance.userPanningEnabled(false);
        cyRefInstance.userZoomingEnabled(false);
        cyRefInstance.boxSelectionEnabled(false);
        // Remove all listeners before destroying
        cyRefInstance.removeAllListeners();
        // Use setTimeout to allow any pending touch event handlers to complete
        // before destroying the instance. This prevents the "Cannot read properties
        // of undefined (reading 'emit')" error on mobile devices.
        // Intentionally fire-and-forget since this is cleanup code
        setTimeout(() => {
          try {
            cyRefInstance.destroy();
          } catch (e) {
            if (e instanceof Error) {
              // Only suppress the known "destroyed" error from cytoscape
              if (isCytoscapeError(e, "destroyed")) {
                return; // Silently ignore expected error
              }
              // Log all other errors - these are unexpected
              console.warn("Unexpected error destroying cytoscape:", e);
            }
          }
        }, 0);
      }
    };
  }, [stopLayout]);

  // Set Cytoscape
  const setCytoscape = useCallback((ref: cytoscape.Core) => {
    if (isMountedRef.current && ref) {
      cyRef.current = ref;
    }
  }, []);

  // User Searching
  const userSearchSchema = getSearchValidator({ max: 10 });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });

  const watchedUsers = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });

  // Memoize highlights array to provide stable reference
  const highlights = useMemo(() => {
    return watchedUsers.map((u) => u.userId);
  }, [watchedUsers]);

  const joinedHighlights = [...highlights].sort((a, b) => (a < b ? -1 : 1)).join(",");

  // If we are highlighting users, find out which users to show
  // Memoize showIds to prevent triggering elements recalculation every render
  const showIds = useMemo(() => {
    return highlights.length > 0
      ? props.edges
          .filter((e) => highlights.includes(e.source) || highlights.includes(e.target))
          .flatMap((edge) => [edge.source, edge.target])
      : props.hideDefault
        ? []
        : null;
  }, [highlights, props.edges, props.hideDefault]);

  // Second layer
  // showIds?.push(
  //   ...props.edges
  //     .filter((e) => showIds.includes(e.source) || showIds.includes(e.target))
  //     .flatMap((edge) => [edge.source, edge.target]),
  // );

  // Memoize elements array to provide stable reference for useMemo dependencies
  const elements = useMemo(() => {
    const maxWeight = Math.max(...props.edges.map((x) => x.weight));
    return [
      ...props.nodes
        .filter((n) => !showIds || showIds.includes(n.id))
        .map((user) => ({ data: user })),
      ...props.edges
        .filter(
          (e) => !showIds || (showIds.includes(e.source) && showIds.includes(e.target)),
        )
        .map((e) => ({
          data: { ...e, weight: (5 * maxWeight) / e.weight, classes: "autorotate" },
        })),
    ];
  }, [props.nodes, props.edges, showIds]);

  // Stop any running layout before re-rendering graph, then run new layout
  useEffect(() => {
    stopLayout();

    // Run layout after elements change
    if (cyRef.current && isMountedRef.current) {
      const layout = cyRef.current.layout({
        name: "cose",
        idealEdgeLength: (edge) => edge.data().weight as number,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: true,
        componentSpacing: 100,
        nodeRepulsion: () => 400000,
        edgeElasticity: (edge) => edge.data().weight as number,
        nestingFactor: 5,
        gravity: 80,
        numIter: isMobileDevice ? 500 : 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
        // Track layout lifecycle
        ready: () => {
          if (isMountedRef.current) {
            layoutRunningRef.current = true;
          }
        },
        stop: () => {
          layoutRunningRef.current = false;
          layoutInstanceRef.current = null;
        },
      });
      layoutInstanceRef.current = layout;
      layout.run();
    }
  }, [joinedHighlights, elements, stopLayout, isMobileDevice]);

  // Memo
  const graph = useMemo(() => {
    return (
      <div className="h-full w-full">
        <CytoscapeComponent
          elements={elements}
          cy={setCytoscape}
          layout={{ name: "preset" }}
          style={{ width: "100%", height: "100%" }}
          stylesheet={
            [
              {
                selector: "node[name]",
                style: {
                  content: "data(name)",
                  color: color,
                },
              },
              {
                selector: "edge",
                style: {
                  "curve-style": "bezier",
                  "target-arrow-shape": "triangle",
                  color: color,
                },
              },
              {
                selector: "edge[label]",
                style: {
                  label: "data(label)",
                  width: 3,
                  "edge-text-rotation": "autorotate",
                  "font-size": 8,
                  color: color,
                },
              },
              {
                selector: "node[label]",
                style: {
                  label: "data(label)",
                  "font-size": 8,
                  color: color,
                },
              },
              ...props.nodes.map((node) => {
                const highlighted = highlights.includes(node.id);
                return {
                  selector: `#${node.id}`,
                  style: {
                    backgroundImage: node.img || IMG_AVATAR_DEFAULT,
                    backgroundWidth: "100%",
                    backgroundHeight: "100%",
                    shape: "ellipse",
                    width: highlighted ? 60 : 30,
                    height: highlighted ? 60 : 30,
                    borderWidth: highlighted ? 5 : 1,
                    borderColor: highlighted ? "red" : color,
                  },
                };
              }),
            ] as Cytoscape.StylesheetStyle[]
          }
        />
      </div>
    );
  }, [
    joinedHighlights,
    elements,
    setCytoscape,
    isMobileDevice,
    props.nodes,
    highlights,
    color,
  ]);

  // Render
  return (
    <div className="relative h-full w-full">
      <div className="absolute top-0 z-50 w-full">
        <UserSearchSelect
          useFormMethods={userSearchMethods}
          label="Users to highlight"
          showAi={false}
          showYourself={true}
          maxUsers={10}
        />
      </div>
      {graph}
    </div>
  );
};

const isCytoscapeError = (error: Error, expectedMessage: string): boolean => {
  const stackFrames = parseStackFrames(error.stack);
  const isFromCytoscape = stackFrames?.some((frame) =>
    frame.filename?.includes("cytoscape"),
  );
  return error.message.includes(expectedMessage) && isFromCytoscape;
};

export default React.memo(GraphUsersGeneric);
