"use client";

import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import ChatInputField from "@/layout/ChatInputField";
import { nanoid } from "nanoid";
import { api } from "@/app/_trpc/client";
import { useEffect, use, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { EditContent } from "@/layout/EditContent";
import { ObjectiveFormWrapper } from "@/layout/EditContent";
import { FilePlus, FileMinus } from "lucide-react";
import { useRequiredUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import { allObjectiveTasks } from "@/validators/objectives";
import { useQuestEditForm } from "@/hooks/quest";
import { QuestValidator, ObjectiveReward } from "@/validators/objectives";
import { SimpleObjective } from "@/validators/objectives";
import { getObjectiveSchema } from "@/validators/objectives";
import type { ZodQuestType, AllObjectivesType } from "@/validators/objectives";
import type { Quest } from "@/drizzle/schema";
import CytoscapeComponent from "react-cytoscapejs";
import { QuestHelper } from "@/layout/ContentHelp";
import type { ElementDefinition, Core, EventObjectNode, EventObject } from "cytoscape";
import { getObjectiveImage, buildObjectiveEdges } from "@/libs/objectives";
import { verifyQuestObjectiveFlow } from "@/libs/quest";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
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
    consecutiveObjectives,
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
          <div className="flex flex-row">
            <FileMinus
              className="h-6 w-6 cursor-pointer hover:text-orange-500"
              onClick={() => removeObjective(i)}
            />
          </div>
        }
      >
        <ObjectiveFormWrapper
          idx={i}
          objective={objective}
          availableTags={[...allObjectiveTasks].sort()}
          objectives={objectives}
          setObjectives={setObjectives}
          consecutiveObjectives={consecutiveObjectives}
        />
      </ContentBox>
    );
  };

  // Validate objective flow whenever objectives or consecutive flag changes
  const { check: isFlowValid, message: flowErrorMsg } = useMemo(() => {
    if (!consecutiveObjectives) {
      return { check: true, message: "" };
    }
    return verifyQuestObjectiveFlow(objectives);
  }, [objectives, consecutiveObjectives]);

  return (
    <>
      <ContentBox
        title="Content Panel"
        subtitle="Quest Management"
        back_href="/manual/quest"
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
                        "attackers",
                        "image",
                      ].includes(key)
                    ) {
                      continue;
                    } else if (key === "content") {
                      const newObjectives = data.content?.objectives
                        ?.map((objective) => {
                          const schema = getObjectiveSchema(objective.task);
                          const parsed = schema.safeParse({
                            ...objective,
                            id: nanoid(5),
                          });
                          if (parsed.success) {
                            return parsed.data;
                          } else {
                            return undefined;
                          }
                        })
                        .filter((e): e is NonNullable<typeof e> => e !== undefined);
                      setObjectives(newObjectives);
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
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold">Edit Quest</h1>
          </div>
        )}

        {props.quest && (
          <EditContent
            schema={QuestValidator._def.schema.merge(ObjectiveReward)}
            form={form}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save to Database"
            type="quest"
            relationId={props.quest.id}
            allowImageUpload={true}
            onAccept={handleQuestSubmit}
            submitDisabled={consecutiveObjectives && !isFlowValid}
          />
        )}
      </ContentBox>
      <ObjectiveFlowGraph
        consecutiveObjectives={consecutiveObjectives}
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
    </>
  );
};

interface ObjectiveFlowGraphProps {
  consecutiveObjectives: boolean;
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
  // Memoize elements for performance
  const elements = useMemo(() => {
    const nodes: ElementDefinition[] = objectives.map((obj) => {
      const { image } = getObjectiveImage(obj);
      return {
        data: {
          id: obj.id,
          label: obj.task,
          description: obj.description ?? "",
          image,
        },
        classes: obj.id === selectedObjectiveId ? "selected" : "",
      };
    });
    const edges = buildObjectiveEdges(objectives, consecutiveObjectives);
    return [...nodes, ...edges];
  }, [objectives, consecutiveObjectives, selectedObjectiveId]);

  // Cytoscape ref and event handling
  const cyRef = useRef<Core | null>(null);

  // Tooltip state & container ref
  const [tooltipData, setTooltipData] = useState<{
    x: number;
    y: number;
    task: string;
    description: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Helper to update edges
  const updateEdges = (cy: Core) => {
    cy.edges().forEach((edge) => {
      if (edge.id().includes("__to__")) {
        edge.remove();
      }
    });
    if (consecutiveObjectives) {
      const edges = buildObjectiveEdges(objectives, consecutiveObjectives);
      edges.forEach(({ data }) => {
        if (data.id && !cy.getElementById(data.id).length) {
          cy.add({ group: "edges", data });
        }
      });
    }
    cy.layout({ name: "cose", fit: true, padding: 30, randomize: true }).run();
  };

  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    updateEdges(cy);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consecutiveObjectives, objectives, setSelectedObjectiveId]);

  return (
    <ContentBox
      title="Quest Flow"
      subtitle="Control flow of objectives"
      initialBreak={true}
      topRightContent={<div className="flex flex-row">{addObjectiveIcon}</div>}
    >
      <div ref={containerRef} className="w-full h-96 relative">
        <CytoscapeComponent
          cy={(cy) => {
            cyRef.current = cy;
          }}
          elements={elements}
          layout={{ name: "cose", fit: true, padding: 30, randomize: true }}
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
                fontSize: 8,
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
          ]}
        />
        {tooltipData && (
          <div
            className="absolute z-50 pointer-events-none bg-gray-900 bg-opacity-80 text-white text-xs rounded px-2 py-1"
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
