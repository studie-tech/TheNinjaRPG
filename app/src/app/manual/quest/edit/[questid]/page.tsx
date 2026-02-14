"use client";

import type { Core, ElementDefinition, EventObject, EventObjectNode } from "cytoscape";
import { Copy, FileMinus, FilePlus } from "lucide-react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Quest } from "@/drizzle/schema";
import { useQuestEditForm } from "@/hooks/quest";
import ChatInputField from "@/layout/ChatInputField";
import ContentBox from "@/layout/ContentBox";
import { QuestHelper } from "@/layout/ContentHelp";
import { EditContent, ObjectiveFormWrapper } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { RaidThresholdEditor } from "@/layout/RaidThresholdEditor";
import { buildObjectiveEdges, getObjectiveImage } from "@/libs/objectives";
import { verifyQuestObjectiveFlow } from "@/libs/quest";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import type {
  AllObjectivesType,
  ZodQuestFormType,
  ZodQuestType,
} from "@/validators/objectives";
import {
  allObjectiveTasks,
  getObjectiveSchema,
  QuestFormRawSchema,
  SimpleObjective,
} from "@/validators/objectives";

export default function ManualBloodlineEdit(props: {
  params: Promise<{ questid: string }>;
}) {
  const params = use(props.params);
  // Setup
  const questId = params.questid;
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.quests.get.useQuery(
    { id: questId },
    { enabled: !!questId },
  );

  // Redirect to profile if not content or admin
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      void router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !canChangeContent(userData.role)) {
    return <Loader explanation="Loading data" />;
  }
  if (!data) {
    return (
      <ContentBox
        title="Quest Not Found"
        subtitle="Could not find this quest"
        defaultBackHref="/manual/quest"
      >
        <p>Could not find this quest</p>
      </ContentBox>
    );
  }

  return <SingleEditQuest quest={data} refetch={refetch} />;
}

interface SingleEditQuestProps {
  quest: Quest;
  refetch: () => void;
}

const SingleEditQuest: React.FC<SingleEditQuestProps> = (props) => {
  const {
    currentValues,
    objectives,
    form,
    formData,
    setObjectives,
    handleQuestSubmit,
  } = useQuestEditForm(props.quest, props.refetch);

  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);

  // Handlers for adding/removing objectives
  const addObjective = () => {
    setObjectives([
      ...objectives,
      SimpleObjective.parse({
        id: nanoid(5),
        task: "pvp_kills",
        value: 10,
        reward: {},
      }),
    ]);
  };

  const removeObjective = (idx: number) => {
    const newObjectives = [...objectives];
    newObjectives.splice(idx, 1);
    setObjectives(newObjectives);
    setSelectedObjectiveId(null);
  };

  const copyObjective = (idx: number) => {
    const objectiveToCopy = objectives[idx];
    if (!objectiveToCopy) return;

    const copiedObjective = {
      ...objectiveToCopy,
      id: nanoid(5),
    };

    const newObjectives = [...objectives];
    newObjectives.splice(idx + 1, 0, copiedObjective);
    setObjectives(newObjectives);
    setSelectedObjectiveId(copiedObjective.id);
  };

  const AddObjectiveIcon = (
    <FilePlus
      className="h-6 w-6 cursor-pointer hover:text-orange-500"
      onClick={addObjective}
    />
  );

  // Helper to render selected objective
  const renderSelectedObjective = () => {
    if (!selectedObjectiveId) return null;
    const i = objectives.findIndex((obj) => obj.id === selectedObjectiveId);
    if (i === -1) return null;
    const objective = objectives[i];
    if (!objective) return null;
    return (
      <ContentBox
        key={objective.id}
        title={`Quest Objective #${i + 1}`}
        subtitle={`ID: ${objective.id}`}
        initialBreak={true}
        topRightContent={
          <div className="flex flex-row gap-2">
            <Copy
              className="h-6 w-6 cursor-pointer hover:text-orange-500"
              onClick={() => copyObjective(i)}
            />
            <FileMinus
              className="h-6 w-6 cursor-pointer hover:text-orange-500"
              onClick={() => removeObjective(i)}
            />
          </div>
        }
      >
        <ObjectiveFormWrapper
          idx={i}
          quest={currentValues}
          objective={objective}
          availableTags={[...allObjectiveTasks].sort()}
          objectives={objectives}
          setObjectives={setObjectives}
        />
      </ContentBox>
    );
  };

  // Validate objective flow whenever objectives or consecutive flag changes
  const { check: isFlowValid, message: flowErrorMsg } = useMemo(() => {
    if (!currentValues.consecutiveObjectives) {
      return { check: true, message: "" };
    }
    return verifyQuestObjectiveFlow(objectives);
  }, [objectives, currentValues.consecutiveObjectives]);

  return (
    <>
      <ContentBox
        title="Content Panel"
        subtitle="Quest Management"
        defaultBackHref="/manual/quest"
        noRightAlign={true}
        topRightContent={
          <div className="flex flex-row gap-2">
            {formData.find((e) => e.id === "description") ? (
              <ChatInputField
                inputProps={{
                  id: "chatInput",
                  placeholder: "Instruct ChatGPT to edit",
                }}
                aiProps={{
                  apiEndpoint: "/api/chat/quest",
                  systemMessage: `\n                  Current quest data: ${JSON.stringify(form.getValues())}. \n                  Current objectives: ${JSON.stringify(objectives)}\n                `,
                }}
                onToolCall={(toolCall) => {
                  const data = toolCall.args as ZodQuestType;
                  let key: keyof typeof data;
                  for (key in data) {
                    if (
                      [
                        "requiredVillage",
                        "reward_items",
                        "reward_jutsus",
                        "reward_badges",
                        "reward_bloodlines",
                        "reward_rank",
                        "reward_village_membership",
                        "attackers",
                        "image",
                      ].includes(key)
                    ) {
                    } else if (key === "content") {
                      const newObjectives: AllObjectivesType[] | undefined =
                        data.content?.objectives?.map((objective) => {
                          const schema = getObjectiveSchema(objective.task);
                          const parsed = schema.safeParse({
                            ...objective,
                            id: nanoid(5),
                          });
                          return parsed.success ? parsed.data : objective;
                        });
                      if (newObjectives) {
                        setObjectives(newObjectives);
                      }
                    } else {
                      form.setValue(key, data[key], { shouldDirty: true });
                    }
                  }
                  void form.trigger();
                }}
              />
            ) : undefined}
            {currentValues && <QuestHelper quest={currentValues} />}
          </div>
        }
      >
        {!props.quest && <p>Could not find this item</p>}
        {props.quest && (
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-bold text-2xl">Edit Quest</h1>
          </div>
        )}

        {props.quest && (
          <EditContent
            schema={QuestFormRawSchema}
            form={form as UseFormReturn<ZodQuestFormType>}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save to Database"
            type="quest"
            relationId={props.quest.id}
            allowImageUpload={true}
            onAccept={handleQuestSubmit}
            submitDisabled={currentValues.consecutiveObjectives && !isFlowValid}
          />
        )}
      </ContentBox>
      <ObjectiveFlowGraph
        consecutiveObjectives={currentValues.consecutiveObjectives}
        objectives={objectives}
        addObjectiveIcon={AddObjectiveIcon}
        selectedObjectiveId={selectedObjectiveId}
        setSelectedObjectiveId={setSelectedObjectiveId}
        isFlowValid={isFlowValid}
        flowErrorMsg={flowErrorMsg}
      />
      {objectives?.length === 0 && (
        <ContentBox
          title={`Quest Objective`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddObjectiveIcon}</div>}
        >
          Please add objectives to this quest
        </ContentBox>
      )}
      {renderSelectedObjective()}

      {/* Damage Thresholds for Raids */}
      {currentValues.questType === "raid" && (
        <ContentBox
          title="Damage Thresholds"
          subtitle="Configure reward tiers based on damage dealt"
          initialBreak={true}
        >
          <RaidThresholdEditor questId={props.quest.id} />
        </ContentBox>
      )}
    </>
  );
};

interface ObjectiveFlowGraphProps {
  consecutiveObjectives?: boolean;
  objectives: AllObjectivesType[];
  addObjectiveIcon: React.ReactNode;
  selectedObjectiveId: string | null;
  setSelectedObjectiveId: (id: string | null) => void;
  isFlowValid: boolean;
  flowErrorMsg: string;
}

const ObjectiveFlowGraph: React.FC<ObjectiveFlowGraphProps> = ({
  consecutiveObjectives,
  objectives,
  addObjectiveIcon,
  selectedObjectiveId,
  setSelectedObjectiveId,
  isFlowValid,
  flowErrorMsg,
}) => {
  // Cytoscape ref and event handling
  const cyRef = useRef<Core | null>(null);
  const nodePositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const isInitialLayoutRef = useRef(true);

  // Tooltip state & container ref
  const [tooltipData, setTooltipData] = useState<{
    x: number;
    y: number;
    task: string;
    description: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize elements for performance
  const elements = useMemo(() => {
    const nodes: ElementDefinition[] = objectives.map((obj) => {
      const { image } = getObjectiveImage(obj);
      const position = nodePositionsRef.current[obj.id];
      return {
        data: {
          id: obj.id,
          label: obj.task,
          description: obj.description ?? "",
          image,
        },
        classes: obj.id === selectedObjectiveId ? "selected" : "",
        position: position, // Use stored position if available
      };
    });
    const edges = buildObjectiveEdges(objectives, consecutiveObjectives ?? false);
    return [...nodes, ...edges];
  }, [objectives, consecutiveObjectives, selectedObjectiveId]);

  // Save node positions after layout
  const saveNodePositions = (cy: Core) => {
    cy.nodes().forEach((node) => {
      const pos = node.position();
      nodePositionsRef.current[node.id()] = { x: pos.x, y: pos.y };
    });
  };

  // Helper to update graph incrementally
  const updateGraph = (cy: Core) => {
    // Get current node and edge IDs
    const currentNodeIds = new Set(cy.nodes().map((n) => n.id()));
    const currentEdgeIds = new Set(cy.edges().map((e) => e.id()));

    // Get new node and edge IDs
    const newNodeIds = new Set(objectives.map((obj) => obj.id));
    const newEdges = consecutiveObjectives
      ? buildObjectiveEdges(objectives, consecutiveObjectives)
      : [];
    const newEdgeIds = new Set(newEdges.map((e) => e.data.id).filter(Boolean));

    // Remove deleted nodes
    currentNodeIds.forEach((id) => {
      if (!newNodeIds.has(id)) {
        cy.getElementById(id).remove();
        delete nodePositionsRef.current[id];
      }
    });

    // Remove deleted edges
    currentEdgeIds.forEach((id) => {
      if (!newEdgeIds.has(id)) {
        cy.getElementById(id).remove();
      }
    });

    // Add new nodes
    const nodesToAdd: string[] = [];
    objectives.forEach((obj) => {
      if (!currentNodeIds.has(obj.id)) {
        const { image } = getObjectiveImage(obj);
        cy.add({
          group: "nodes",
          data: {
            id: obj.id,
            label: obj.task,
            description: obj.description ?? "",
            image,
          },
        });
        nodesToAdd.push(obj.id);
      } else {
        // Update existing node data
        const node = cy.getElementById(obj.id);
        const { image } = getObjectiveImage(obj);
        node.data({
          label: obj.task,
          description: obj.description ?? "",
          image,
        });
      }
    });

    // Add new edges
    newEdges.forEach(({ data }) => {
      if (data.id && !currentEdgeIds.has(data.id)) {
        cy.add({ group: "edges", data });
      }
    });

    // Only run layout for new nodes, or full layout if it's the initial render
    if (nodesToAdd.length > 0 || isInitialLayoutRef.current) {
      const layout = cy.layout({
        name: "cose",
        fit: isInitialLayoutRef.current,
        padding: 30,
        randomize: isInitialLayoutRef.current, // Only randomize on initial layout
        animate: !isInitialLayoutRef.current,
        animationDuration: 300,
        nodeOverlap: 20,
      });

      layout.on("layoutstop", () => {
        saveNodePositions(cy);
        isInitialLayoutRef.current = false;
      });

      layout.run();
    } else {
      // Just save current positions
      saveNodePositions(cy);
    }
  };

  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    updateGraph(cy);

    // Setup event listeners (only once)
    cy.removeListener("tap", "node");
    cy.removeListener("tap");
    cy.removeListener("mouseover", "node");
    cy.removeListener("mouseout", "node");

    cy.on("tap", "node", (event: EventObjectNode) => {
      const nodeId = event.target.id();
      setSelectedObjectiveId(nodeId);
    });

    cy.on("tap", (event: EventObject) => {
      if (event.target === cy) {
        setSelectedObjectiveId(null);
      }
    });

    // Tooltip handlers
    cy.on("mouseover", "node", (event: EventObjectNode) => {
      const node = event.target;
      const pos = node.renderedPosition();
      setTooltipData({
        x: pos.x,
        y: pos.y,
        task: node.data("label") as string,
        description: (node.data("description") ?? "") as string,
      });
    });

    cy.on("mouseout", "node", () => {
      setTooltipData(null);
    });
  }, [consecutiveObjectives, objectives]);

  return (
    <ContentBox
      title="Quest Flow"
      subtitle="Control flow of objectives"
      initialBreak={true}
      topRightContent={<div className="flex flex-row">{addObjectiveIcon}</div>}
    >
      <div ref={containerRef} className="relative aspect-square w-full">
        <CytoscapeComponent
          cy={(cy) => {
            cyRef.current = cy;
          }}
          elements={elements}
          layout={{ name: "preset" }}
          style={{ width: "100%", height: "100%" }}
          stylesheet={[
            {
              selector: "node",
              style: {
                "background-color": "#6366f1",
                color: "#0000",
                width: 40,
                height: 40,
                "background-image": "data(image)",
                "background-fit": "cover",
              },
            },
            {
              selector: "node[label]",
              style: {
                label: "data(id)",
                "font-size": 8,
                color: "#f59e42",
              },
            },
            {
              selector: "node.selected",
              style: {
                "border-width": 4,
                "border-color": "#f59e42",
                "border-style": "solid",
              },
            },
            {
              selector: "edge",
              style: {
                width: 3,
                "line-color": "#a5b4fc",
                "target-arrow-color": "#a5b4fc",
                "target-arrow-shape": "triangle",
                "curve-style": "bezier",
              },
            },
            {
              selector: "edge.fail-edge",
              style: {
                "line-color": "#ef4444",
                "target-arrow-color": "#ef4444",
              },
            },
            {
              selector: "edge.reset-edge",
              style: {
                "line-color": "#048700",
                "target-arrow-color": "#048700",
              },
            },
          ]}
        />
        {tooltipData && (
          <div
            className="pointer-events-none absolute z-50 rounded bg-gray-900 bg-opacity-80 px-2 py-1 text-white text-xs"
            style={{
              top: tooltipData.y,
              left: tooltipData.x,
              transform: "translate(-50%, -120%)",
            }}
          >
            <p className="font-semibold">{tooltipData.task}</p>
            {tooltipData.description && <p>{tooltipData.description}</p>}
          </div>
        )}
      </div>
      {/* Alert about invalid objective flow */}
      {consecutiveObjectives && !isFlowValid && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Objective flow invalid</AlertTitle>
          <AlertDescription>{flowErrorMsg}</AlertDescription>
        </Alert>
      )}
    </ContentBox>
  );
};
