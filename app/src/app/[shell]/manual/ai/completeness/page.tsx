"use client";

import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import { CompletenessMark } from "@/layout/ContentCompletenessCharts";
import { ContentLinksCell } from "@/layout/ContentLinksCell";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserDataSelector } from "@/utils/UserContext";

/** Content editors find AIs whose actions lack their own sprite animation sheets. */
export default function ManualAiCompleteness() {
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const canEdit = !!userData && canChangeContent(userData.role);
  const { data, isPending, error, refetch } =
    api.spriteAnimation.getAiCoverage.useQuery(undefined, { enabled: canEdit });

  const rows = data
    ?.filter((ai) => ai.animated < ai.total)
    .map((ai) => ({
      name: ai.username,
      links: <ContentLinksCell type="ai" id={ai.userId} canEdit />,
      idle: <CompletenessMark missing={!ai.hasIdle} />,
      coverage: `${ai.animated} / ${ai.total}`,
      missing: ai.missing.join(", "),
      missingCount: ai.total - ai.animated,
      hasIdle: ai.hasIdle,
    }))
    .sort(
      (a, b) =>
        Number(a.hasIdle) - Number(b.hasIdle) || b.missingCount - a.missingCount,
    );

  type Row = ArrayElement<typeof rows>;
  const columns: ColumnDefinitionType<Row, keyof Row>[] = [
    { key: "name", header: "Name", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "idle", header: "Idle animation", type: "jsx" },
    { key: "coverage", header: "Animated actions", type: "string" },
    { key: "missing", header: "Missing animations", type: "string" },
  ];

  return (
    <ContentBox
      title="Completeness"
      subtitle="AI sprite animations"
      defaultBackHref="/manual/ai"
      padding={false}
    >
      <p className="p-3">
        AIs with actions that have no sprite animation of their own. Those actions play
        the idle animation, and an AI without an idle animation shows its static image.
      </p>
      {!userData ? (
        <Loader explanation="Loading user" />
      ) : !canEdit ? (
        <p className="p-3">Only content editors can view AI animation coverage.</p>
      ) : isPending ? (
        <Loader explanation="Loading AI animations" />
      ) : error ? (
        <div role="alert" className="p-3">
          <p>Could not load AI animations. {error.message}</p>
          <Button variant="outline" className="mt-2" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : rows?.length ? (
        <Table data={rows} columns={columns} />
      ) : (
        <p className="p-3">Every AI action has its own sprite animation.</p>
      )}
    </ContentBox>
  );
}
