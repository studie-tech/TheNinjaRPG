"use client";

import type { Core, ElementDefinition, EventObject, EventObjectNode } from "cytoscape";
import { Copy, FileMinus, FilePlus } from "lucide-react";
import { nanoid } from "nanoid";
import { use, useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  isPetTaskQuestType,
  VILLAGE_MISSION_ONLY_TASKS,
  VILLAGE_MISSION_RANK_POINTS,
  VILLAGE_MISSION_TASKS,
} from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import { useQuestEditForm } from "@/hooks/quest";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { QuestHelper } from "@/layout/ContentHelp";
import { EditContent } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { ObjectiveFormWrapper } from "@/layout/ObjectiveFormWrapper";
import { RaidThresholdEditor } from "@/layout/RaidThresholdEditor";
import { RewardEditor } from "@/layout/RewardEditor";
import { SuggestChange } from "@/layout/SuggestChange";
import { buildObjectiveEdges, getObjectiveImage } from "@/libs/objectives";
import { PET_TASK_MIN_RANK_NAME } from "@/libs/pets/tasks";
import { verifyQuestObjectiveFlow } from "@/libs/quest/validation";
import { getQuestFlowPositions, restoreQuestFlowPositions } from "@/libs/questFlow";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import type {
  AllObjectivesType,
  QuestNodePositions,
  ZodQuestFormType,
} from "@/validators/objectives";
import {
  allObjectiveTasks,
  QuestFormRawSchema,
  SimpleObjective,
} from "@/validators/objectives";

/** Load quest data and enforce staff access before mounting the editing form. */
export default function ManualQuestEdit(props: {
  params: Promise<{ questid: string }>;
}) {
  const params = use(props.params);
  // Setup
  const questId = params.questid;
  const { userData, hasAccess } = useRequireRole(isStaffRole);

  // Queries
  const { data, isPending, refetch } = api.quests.get.useQuery(
    { id: questId },
    { enabled: !!questId },
  );

  // Prevent unauthorized access
  if (isPending || !userData || !hasAccess) {
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

  return (
    <SingleEditQuest
      key={data.id}
      quest={data}
      refetch={refetch}
      canSave={canChangeContent(userData.role)}
    />
  );
}

interface SingleEditQuestProps {
  /** Staff who cannot save content still get the editor, to suggest changes. */
  canSave: boolean;
  quest: Quest;
  refetch: () => Promise<unknown>;
}

const SingleEditQuest: React.FC<SingleEditQuestProps> = (props) => {
  const {
    currentValues,
    objectives,
    form,
    formData,
    setObjectives,
    setNodePositions,
    handleQuestSubmit,
    getSuggestionData,
    isUpdating,
  } = useQuestEditForm(props.quest, props.refetch);

  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);

  // Handlers for adding/removing objectives
  const addObjective = () => {
    if (isUpdating) return;
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
    if (isUpdating) return;
    const newObjectives = [...objectives];
    newObjectives.splice(idx, 1);
    setObjectives(newObjectives);
    setSelectedObjectiveId(null);
  };

  /** Duplicate an objective with fresh attachment ids while retaining each package's source. */
  const copyObjective = (idx: number) => {
    if (isUpdating) return;
    const objectiveToCopy = objectives[idx];
    if (!objectiveToCopy) return;

    const copiedObjective = {
      ...objectiveToCopy,
      id: nanoid(5),
      reward_packages: objectiveToCopy.reward_packages?.map((pack) => ({
        ...pack,
        id: nanoid(),
      })),
    };

    const newObjectives = [...objectives];
    newObjectives.splice(idx + 1, 0, copiedObjective);
    setObjectives(newObjectives);
    setSelectedObjectiveId(copiedObjective.id);
  };

  const AddObjectiveIcon = (
    <FilePlus
      className={`h-6 w-6 ${
        isUpdating
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:text-orange-500"
      }`}
      aria-disabled={isUpdating}
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
              className={`h-6 w-6 ${
                isUpdating
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:text-orange-500"
              }`}
              aria-disabled={isUpdating}
              onClick={() => copyObjective(i)}
            />
            <FileMinus
              className={`h-6 w-6 ${
                isUpdating
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:text-orange-500"
              }`}
              aria-disabled={isUpdating}
              onClick={() => removeObjective(i)}
            />
          </div>
        }
      >
        <ObjectiveFormWrapper
          idx={i}
          quest={currentValues}
          objective={objective}
          availableTags={
            currentValues.questType === "village_mission"
              ? [...VILLAGE_MISSION_TASKS]
              : [...allObjectiveTasks]
                  .filter(
                    (task) =>
                      !(VILLAGE_MISSION_ONLY_TASKS as readonly string[]).includes(task),
                  )
                  .sort()
          }
          objectives={objectives}
          setObjectives={setObjectives}
          submitLoading={isUpdating}
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
    <div aria-busy={isUpdating}>
      {isUpdating && (
        <span role="status" aria-live="polite" className="sr-only">
          Saving
        </span>
      )}
      <ContentBox
        title="Content Panel"
        subtitle="Quest Management"
        defaultBackHref="/manual/quest"
        topRightContent={<QuestHelper quest={currentValues} />}
      >
        {currentValues.questType === "village_mission" && (
          <p className="mb-4 rounded border p-3 text-sm">
            Village Missions use simultaneous shared objectives and pay only the
            completed quest&apos;s Token reward to the village. Use PvP kills, Siege
            Operation (enemy shrine HP damage), Combined Mission Effort (
            {Object.entries(VILLAGE_MISSION_RANK_POINTS)
              .map(([rank, points]) => `${rank}: ${points}`)
              .join(", ")}{" "}
            points), or D–A mission totals. Personal level, bloodline, sage mode and
            prerequisite restrictions do not apply; leave those restrictions empty.
          </p>
        )}
        {isPetTaskQuestType(currentValues.questType) && (
          <p className="mb-4 text-muted-foreground text-sm">
            Set a companion task duration to allow {PET_TASK_MIN_RANK_NAME}-rank
            companions to complete this contract unattended. The task pays only the
            final quest reward and its usual profession drops; objectives, intermediate
            rewards and their effects are not simulated. Leave the duration blank to
            disable tasks.
          </p>
        )}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="font-bold text-2xl">Edit Quest</h1>
        </div>

        <EditContent
          schema={QuestFormRawSchema}
          form={form as UseFormReturn<ZodQuestFormType>}
          formData={formData.filter((entry) => !String(entry.id).startsWith("reward_"))}
          showSubmit={props.canSave}
          buttonTxt="Save to Database"
          type="quest"
          relationId={props.quest.id}
          allowImageUpload={props.canSave}
          onAccept={handleQuestSubmit}
          submitDisabled={currentValues.consecutiveObjectives && !isFlowValid}
          submitLoading={isUpdating}
          submitLoadingText="Saving"
        >
          <RewardEditor type="quest" form={form} formData={formData} />
        </EditContent>
        <div className="mt-2 flex justify-end">
          <SuggestChange
            entityType="QUEST"
            entityId={props.quest.id}
            getData={getSuggestionData}
            label={props.canSave ? "Suggest instead" : "Suggest a change"}
          />
        </div>
      </ContentBox>
      <ObjectiveFlowGraph
        nodePositions={currentValues.content.nodePositions}
        setNodePositions={setNodePositions}
        consecutiveObjectives={currentValues.consecutiveObjectives}
        objectives={objectives}
        addObjectiveIcon={AddObjectiveIcon}
        selectedObjectiveId={selectedObjectiveId}
        setSelectedObjectiveId={setSelectedObjectiveId}
        isFlowValid={isFlowValid}
        flowErrorMsg={flowErrorMsg}
        isUpdating={isUpdating}
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
      {currentValues.questType === "raid" && props.canSave && (
        <ContentBox
          title="Damage Thresholds"
          subtitle="Configure reward tiers based on damage dealt"
          initialBreak={true}
        >
          <RaidThresholdEditor questId={props.quest.id} />
        </ContentBox>
      )}
    </div>
  );
};

const emptyNodePositions: QuestNodePositions = {};

interface ObjectiveFlowGraphProps {
  nodePositions?: QuestNodePositions;
  setNodePositions: (positions: QuestNodePositions) => void;
  consecutiveObjectives?: boolean;
  objectives: AllObjectivesType[];
  addObjectiveIcon: React.ReactNode;
  selectedObjectiveId: string | null;
  setSelectedObjectiveId: (id: string | null) => void;
  isFlowValid: boolean;
  flowErrorMsg: string;
  isUpdating: boolean;
}

/** Keep objective selection and shared layout coordinates synchronized with the quest form. */
const ObjectiveFlowGraph: React.FC<ObjectiveFlowGraphProps> = ({
  nodePositions = emptyNodePositions,
  setNodePositions,
  consecutiveObjectives,
  objectives,
  addObjectiveIcon,
  selectedObjectiveId,
  setSelectedObjectiveId,
  isFlowValid,
  flowErrorMsg,
  isUpdating,
}) => {
  // Cytoscape ref and event handling
  const cyRef = useRef<Core | null>(null);
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
      const position = nodePositions[obj.id];
      return {
        data: {
          id: obj.id,
          label: obj.task,
          description: obj.description ?? "",
          image,
        },
        classes: obj.id === selectedObjectiveId ? "selected" : "",
        position,
      };
    });
    const edges = buildObjectiveEdges(objectives, consecutiveObjectives ?? false);
    return [...nodes, ...edges];
  }, [objectives, consecutiveObjectives, selectedObjectiveId, nodePositions]);

  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    // CytoscapeComponent synchronizes nodes and edges before placement is restored.
    const positions = restoreQuestFlowPositions(cy, nodePositions);
    if (
      Object.keys(positions).length !== Object.keys(nodePositions).length ||
      Object.entries(positions).some(
        ([id, position]) =>
          position.x !== nodePositions[id]?.x || position.y !== nodePositions[id]?.y,
      )
    ) {
      setNodePositions(positions);
    }
    if (isInitialLayoutRef.current && cy.nodes().nonempty()) {
      cy.fit(undefined, 30);
      isInitialLayoutRef.current = false;
    }

    cy.on("dragfree", "node", () => {
      setNodePositions(getQuestFlowPositions(cy));
    });

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
    return () => {
      cy.removeListener("tap");
      cy.removeListener("mouseover", "node");
      cy.removeListener("mouseout", "node");
      cy.removeListener("dragfree", "node");
    };
  }, [
    consecutiveObjectives,
    objectives,
    nodePositions,
    setNodePositions,
    setSelectedObjectiveId,
  ]);

  return (
    <ContentBox
      title="Quest Flow"
      subtitle="Control flow of objectives"
      initialBreak={true}
      topRightContent={<div className="flex flex-row">{addObjectiveIcon}</div>}
    >
      <p className="text-muted-foreground mb-2 text-sm">
        Drag objectives to organize the graph. Layouts are shared when a content editor
        saves the quest.
      </p>
      <div
        ref={containerRef}
        className={`relative aspect-square w-full ${
          isUpdating ? "pointer-events-none opacity-60" : ""
        }`}
        aria-disabled={isUpdating}
      >
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
