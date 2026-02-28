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
const GraphUsersGeneric: React.FC<GraphUsersGenericProps> = (props) => {
  // State
  const localTheme = safeLocalStorageGetItem("theme");
  const cyRef = useRef<Cytoscape.Core | null>(null);
  const isMountedRef = useRef(true);
  const layoutRunningRef = useRef(false);
  const isMobile =
    typeof window !== "undefined" &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  const color = localTheme === "dark" ? "white" : "black";

  // Cleanup cytoscape instance on unmount to prevent touch event race conditions
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (cyRef.current) {
        const cyRefInstance = cyRef.current;
        cyRef.current = null;

        // Stop any running layout first to prevent "Cannot read properties of null (reading 'notify')" errors
        if (layoutRunningRef.current) {
          try {
            // Stop all running layouts
            cyRefInstance.elements().layout({ name: "null" }).stop();
            layoutRunningRef.current = false;
          } catch {
            // Ignore errors if layout is already stopped
          }
        }

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
          } catch {
            // Ignore errors during cleanup - the instance may already be partially destroyed
          }
        }, 0);
      }
    };
  }, []);

  // Set Cytoscape
  const setCytoscape = useCallback(
    (ref: cytoscape.Core) => {
      if (isMountedRef.current && ref) {
        cyRef.current = ref;
      }
    },
    [cyRef],
  );

  // User Searching
  const userSearchSchema = getSearchValidator({ max: 10 });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const highlights = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  }).map((u) => u.userId);
  const joinedHighlights = highlights.sort((a, b) => (a < b ? -1 : 1)).join(",");

  // If we are highlighting users, find out which users to show
  const showIds =
    highlights.length > 0
      ? props.edges
          .filter((e) => highlights.includes(e.source) || highlights.includes(e.target))
          .flatMap((edge) => [edge.source, edge.target])
      : props.hideDefault
        ? []
        : null;

  // Second layer
  // showIds?.push(
  //   ...props.edges
  //     .filter((e) => showIds.includes(e.source) || showIds.includes(e.target))
  //     .flatMap((edge) => [edge.source, edge.target]),
  // );

  // Data
  const maxWeight = Math.max(...props.edges.map((x) => x.weight));
  const elements = [
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

  // Memo
  const graph = useMemo(() => {
    // Stop any running layout from previous render to prevent race conditions
    if (cyRef.current && layoutRunningRef.current) {
      try {
        cyRef.current.elements().layout({ name: "null" }).stop();
        layoutRunningRef.current = false;
      } catch {
        // Ignore errors if already stopped
      }
    }

    return (
      <div className="h-full w-full">
        <CytoscapeComponent
          elements={elements}
          cy={setCytoscape}
          layout={{
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
            numIter: isMobile ? 500 : 1000,
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
            },
          }}
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
  }, [joinedHighlights]);

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

export default React.memo(GraphUsersGeneric);
