"use client";

import { BarChart3, CircleCheckBig, CircleMinus, InfoIcon, Pencil } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/localstorage";
import ContentBox from "@/layout/ContentBox";
import { CountsChart, StackedCountsChart } from "@/layout/ContentCompletenessCharts";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import WordCloud from "@/layout/Wordcloud";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

export default function ManualJutsuBalance() {
  // State
  const availFilters = ["Incomplete", "Diversity"];
  type Tab = (typeof availFilters)[number];
  const [filter, setFilter] = useLocalStorage<Tab>("jutsuComplete", "Incomplete", true);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedJutsuId, setSelectedJutsuId] = useState<string>("");

  // User data for permissions
  const { data: userData } = useUserData();

  // Queries
  const { data, isPending } = api.jutsu.getAll.useQuery({ limit: 500 }, {});
  const allJutsus = data?.data;
  const { data: gameAssets } = api.misc.getAllGameAssetNames.useQuery(undefined);

  // Jutsu details query for modal
  const {
    data: jutsuDetails,
    isPending: isJutsuDetailsPending,
    isError: isJutsuDetailsError,
    isFetching: isJutsuDetailsFetching,
    refetch: refetchJutsuDetails,
  } = api.jutsu.get.useQuery({ id: selectedJutsuId }, { enabled: !!selectedJutsuId });

  // Check if user can edit jutsu
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Table processing
  const assetIdSet = new Set((gameAssets ?? []).map((a) => a.id));
  const processed = allJutsus
    ?.map((jutsu) => {
      // Checks
      const effects = jutsu.effects.length === 0 ? 1 : 0;
      const description = jutsu.description.length < 50 ? 1 : 0;
      const battleDescription = jutsu.battleDescription.length < 50 ? 1 : 0;
      const missingGraphic = !jutsu.effects.some(
        (e) =>
          e.appearAnimation ||
          e.disappearAnimation ||
          e.staticAnimation ||
          e.staticAssetPath,
      )
        ? 1
        : 0;

      const missingSfx = !jutsu.effects.some((e) => e.appearSfx || e.disappearSfx)
        ? 1
        : 0;

      // Check: referenced asset IDs exist in gameAsset table
      const invalidAssets = gameAssets
        ? jutsu.effects.some((e) =>
            [
              e.appearAnimation,
              e.disappearAnimation,
              e.staticAnimation,
              e.staticAssetPath,
            ].some((v) => !!v && !assetIdSet.has(v)),
          )
          ? 1
          : 0
        : 0;

      const total =
        effects +
        description +
        battleDescription +
        missingGraphic +
        missingSfx +
        invalidAssets;
      // Return summary
      return {
        name: jutsu.name,
        links: (
          <div className="flex items-center gap-2">
            <Link href={`/manual/jutsu/statistics/${jutsu.id}`}>
              <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
            </Link>
            {canEdit && (
              <Link href={`/manual/jutsu/edit/${jutsu.id}`}>
                <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
              </Link>
            )}
            <InfoIcon
              className="h-4 w-4 text-muted-foreground hover:text-primary"
              onClick={() => {
                setSelectedJutsuId(jutsu.id);
                setIsModalOpen(true);
              }}
            />
          </div>
        ),
        effects: effects ? (
          <CircleMinus className="h-4 w-4 text-red-500" />
        ) : (
          <CircleCheckBig className="h-4 w-4 text-green-500" />
        ),
        description: description ? (
          <CircleMinus className="h-4 w-4 text-red-500" />
        ) : (
          <CircleCheckBig className="h-4 w-4 text-green-500" />
        ),
        battleDescription: battleDescription ? (
          <CircleMinus className="h-4 w-4 text-red-500" />
        ) : (
          <CircleCheckBig className="h-4 w-4 text-green-500" />
        ),
        missingGraphic: missingGraphic ? (
          <CircleMinus className="h-4 w-4 text-red-500" />
        ) : (
          <CircleCheckBig className="h-4 w-4 text-green-500" />
        ),
        missingSfx: missingSfx ? (
          <CircleMinus className="h-4 w-4 text-red-500" />
        ) : (
          <CircleCheckBig className="h-4 w-4 text-green-500" />
        ),
        assetsExist: invalidAssets ? (
          <CircleMinus className="h-4 w-4 text-red-500" />
        ) : (
          <CircleCheckBig className="h-4 w-4 text-green-500" />
        ),
        total: total,
      };
    })
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total);

  // Table
  type Row = ArrayElement<typeof processed>;
  const columns: ColumnDefinitionType<Row, keyof Row>[] = [
    { key: "name", header: "Jutsu", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "effects", header: "Effects", type: "jsx" },
    { key: "missingGraphic", header: "Graphics", type: "jsx" },
    { key: "missingSfx", header: "SFX", type: "jsx" },
    { key: "assetsExist", header: "Assets Exist", type: "jsx" },
    { key: "description", header: "Description", type: "jsx" },
    { key: "battleDescription", header: "Battle Desc", type: "jsx" },
    { key: "total", header: "Total", type: "jsx" },
  ];

  // Counts per classification
  const classCounts = allJutsus?.reduce<Record<string, number>>((acc, curr) => {
    const key = curr.statClassification || "N/A";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Counts per rank
  const rankCounts = allJutsus?.reduce<Record<string, number>>((acc, curr) => {
    const key = curr.jutsuRank || "N/A";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Counts per effect type and calculation (for stacked bar chart)
  const effectTypeCalculationCounts = allJutsus?.reduce<
    Record<string, Record<string, number>>
  >((acc, jutsu) => {
    jutsu.effects.forEach((effect) => {
      const effectType = effect.type;
      const calculation = effect.calculation || "static";

      if (!acc[effectType]) {
        acc[effectType] = {};
      }
      acc[effectType][calculation] = (acc[effectType][calculation] || 0) + 1;
    });
    return acc;
  }, {});

  // Sort effect types by total count (descending)
  const sortedEffectTypeCalculationCounts = effectTypeCalculationCounts
    ? Object.fromEntries(
        Object.entries(effectTypeCalculationCounts)
          .map(([effectType, calculations]) => ({
            effectType,
            calculations,
            total: Object.values(calculations).reduce((sum, count) => sum + count, 0),
          }))
          .sort((a, b) => b.total - a.total)
          .map(({ effectType, calculations }) => [effectType, calculations]),
      )
    : undefined;

  // Wordclouds
  const allDescriptions = allJutsus?.map((b) => b.description).join(" ");
  const allTitles = allJutsus?.map((b) => b.name).join(" ");

  return (
    <>
      <ContentBox
        title="Completeness"
        subtitle="Missing information etc."
        defaultBackHref="/manual/jutsu"
        padding={false}
        topRightContent={
          <NavTabs current={filter} options={availFilters} setValue={setFilter} />
        }
      >
        <p className="p-3">
          The aim of this overview is to highlight any missing information in content,
          such that we can ensure that content is complete & diverse.
        </p>
        {isPending && <Loader explanation="Loading data" />}
        {!isPending && filter === "Incomplete" && (
          <Table data={processed} columns={columns} />
        )}
        {!isPending && filter === "Diversity" && (
          <div className="p-3">
            <p className="bold text-xl">Description Wordcloud</p>
            <WordCloud text={allDescriptions} />
            <p className="bold text-xl">Title Wordcloud</p>
            <WordCloud text={allTitles} />
            <p className="bold text-xl">Classifications</p>
            <CountsChart data={classCounts} />
            <p className="bold text-xl">Ranking</p>
            <CountsChart data={rankCounts} />
            <p className="bold text-xl">Effect Types</p>
            <StackedCountsChart data={sortedEffectTypeCalculationCounts} />
          </div>
        )}
      </ContentBox>

      {/* Jutsu Details Modal */}
      <Modal
        title="Jutsu Details"
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        proceed_label={null}
      >
        {isJutsuDetailsPending ? (
          <Loader explanation="Loading jutsu details" />
        ) : (
          jutsuDetails && <ItemWithEffects item={jutsuDetails} showStatistic="jutsu" />
        )}
        {isJutsuDetailsError && (
          <div className="space-y-2">
            <p role="alert">Jutsu details could not be loaded. Please try again.</p>
            <Button
              disabled={isJutsuDetailsFetching}
              onClick={() => void refetchJutsuDetails()}
            >
              {isJutsuDetailsFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        )}
        {!isJutsuDetailsPending && !isJutsuDetailsError && !jutsuDetails && (
          <p role="alert">This jutsu could not be found.</p>
        )}
      </Modal>
    </>
  );
}
