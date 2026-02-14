"use client";

import { BarChart3, InfoIcon, Pencil } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import SkillTreeBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/SkillTreeBalanceFiltering";
import SkillTreeFiltering, {
  getFilter as getSkillTreeFilter,
  useFiltering as useSkillTreeFiltering,
} from "@/layout/SkillTreeFiltering";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

export default function ManualSkillTreeBalance() {
  // State
  const availableTabs = ["Usage", "Power"];
  type Tab = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<Tab>("skillTreeBalanceTab", "Usage", true);

  const NavBarBlock = (
    <NavTabs current={tab} options={availableTabs} setValue={setTab} />
  );

  return (
    <>
      {tab === "Usage" && <SkillTreeUsageBalance navTabs={NavBarBlock} />}
      {tab === "Power" && <SkillTreeEffectsBalance navTabs={NavBarBlock} />}
    </>
  );
}

/**
 * Skill Tree Effects Balance
 */
interface SkillTreeEffectsBalanceProps {
  navTabs: React.ReactNode;
}

const SkillTreeEffectsBalance: React.FC<SkillTreeEffectsBalanceProps> = (props) => {
  // Two-level filtering
  const state = useSkillTreeFiltering();
  const { data: userData } = useUserData();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");

  // Queries
  const { data, isPending } = api.data.getSkillTreeEffectsBalanceStatistics.useQuery(
    getSkillTreeFilter(state),
  );

  // Skill details query for modal
  const { data: skillDetails, isPending: isSkillDetailsPending } =
    api.skillTree.get.useQuery({ id: selectedSkillId }, { enabled: !!selectedSkillId });

  // Can edit skill
  const canEdit = canChangeContent(userData?.role ?? "USER");

  const tableData = data
    ?.flatMap((skill) => {
      return skill.effects.map((effect) => {
        return {
          name: skill.name,
          links: (
            <div className="flex items-center gap-2">
              <Link href={`/manual/skillTree/statistics/${skill.id}`}>
                <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
              </Link>
              {canEdit && (
                <Link href={`/manual/skillTree/edit/${skill.id}`}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              <InfoIcon
                className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-primary"
                onClick={() => {
                  setSelectedSkillId(skill.id);
                  setIsModalOpen(true);
                }}
              />
            </div>
          ),
          tier: skill.tier,
          costSkillPoints: skill.costSkillPoints,
          effect: effect.type,
          power: effect.power,
          rounds: effect.rounds,
          powerPerLevel: effect.powerPerLevel,
        };
      });
    })
    .sort((a, b) => b.power - a.power)
    .filter(Boolean);

  type SkillTreeBalanceRow = ArrayElement<typeof tableData>;

  const columns: ColumnDefinitionType<
    SkillTreeBalanceRow,
    keyof SkillTreeBalanceRow
  >[] = [
    { key: "name", header: "Skill Name", type: "string" },
    { key: "links", header: "Actions", type: "jsx" },
    { key: "tier", header: "Tier", type: "string" },
    { key: "costSkillPoints", header: "Cost", type: "string" },
    { key: "effect", header: "Effect", type: "string" },
    { key: "power", header: "Power", type: "string" },
    { key: "rounds", header: "Rounds", type: "string" },
    { key: "powerPerLevel", header: "Power/Level", type: "string" },
  ];

  return (
    <>
      <ContentBox
        title="Skill Tree Effects"
        subtitle="Compare power levels"
        defaultBackHref="/manual/skillTree"
        padding={false}
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            {props.navTabs}
            <SkillTreeFiltering state={state} />
          </div>
        }
      >
        {isPending && <Loader explanation="Loading skill tree effects data" />}
        {!isPending && tableData && <Table data={tableData} columns={columns} />}
      </ContentBox>

      {/* Modal for skill details */}
      <Modal2
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedSkillId("");
        }}
        title="Skill Details"
      >
        {isSkillDetailsPending && <Loader explanation="Loading skill details" />}
        {!isSkillDetailsPending && skillDetails && (
          <ItemWithEffects
            item={skillDetails}
            showEdit={canEdit ? "skillTree" : undefined}
          />
        )}
      </Modal2>
    </>
  );
};

/**
 * Skill Tree Usage Balance
 */
interface SkillTreeUsageBalanceProps {
  navTabs: React.ReactNode;
}

const SkillTreeUsageBalance: React.FC<SkillTreeUsageBalanceProps> = (props) => {
  // State
  const filterState = useFiltering();
  const { data: userData } = useUserData();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getSkillTreeBalanceStatistics.useQuery(filter);
  const { data: skillDetails, isPending: isSkillDetailsPending } =
    api.skillTree.get.useQuery({ id: selectedSkillId }, { enabled: !!selectedSkillId });

  // Check if user can change content
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Process data for table
  const tableData = data?.map((skill) => {
    return {
      name: skill.name,
      links: (
        <div className="flex items-center gap-2">
          <Link href={`/manual/skillTree/statistics/${skill.skillId}`}>
            <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
          </Link>
          {canEdit && (
            <Link href={`/manual/skillTree/edit/${skill.skillId}`}>
              <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
            </Link>
          )}
          <InfoIcon
            className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-primary"
            onClick={() => {
              setSelectedSkillId(skill.skillId);
              setIsModalOpen(true);
            }}
          />
        </div>
      ),
      tier: skill.tier,
      costSkillPoints: skill.costSkillPoints,
      userCount: skill.userCount,
      effects: skill.effects.length,
    };
  });

  type SkillTreeBalanceRow = ArrayElement<typeof tableData>;

  const columns: ColumnDefinitionType<
    SkillTreeBalanceRow,
    keyof SkillTreeBalanceRow
  >[] = [
    { key: "name", header: "Skill Name", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "userCount", header: "#Users", type: "string" },
    { key: "tier", header: "Tier", type: "string" },
    { key: "costSkillPoints", header: "Cost", type: "string" },
    { key: "effects", header: "#Effects", type: "string" },
  ];

  return (
    <>
      <ContentBox
        title="Skill Tree Usage Balance"
        subtitle="Track skill adoption and usage patterns"
        defaultBackHref="/manual/skillTree"
        padding={false}
        topRightContent={
          <div className="flex flex-row items-center gap-2">
            {props.navTabs}
            <SkillTreeBalanceFiltering state={filterState} />
          </div>
        }
      >
        {isPending && <Loader explanation="Loading skill tree usage data" />}
        {!isPending && tableData && <Table data={tableData} columns={columns} />}
      </ContentBox>

      {/* Modal for skill details */}
      <Modal2
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedSkillId("");
        }}
        title="Skill Details"
      >
        {isSkillDetailsPending && <Loader explanation="Loading skill details" />}
        {!isSkillDetailsPending && skillDetails && (
          <ItemWithEffects
            item={skillDetails}
            showEdit={canEdit ? "skillTree" : undefined}
          />
        )}
      </Modal2>
    </>
  );
};
