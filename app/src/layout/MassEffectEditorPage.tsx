"use client";

import { type ComponentProps, type ReactNode, type Ref, useState } from "react";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { EffectFieldSelector, MassEffectEditor } from "@/layout/MassEffectEditor";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export const MassEffectEditorPage = ({
  subtitle,
  defaultBackHref,
  isFetching,
  lastElementRef,
  renderFilter,
  ...editorProps
}: MassEffectEditorPageProps) => {
  const { data: userData } = useUserData();
  const [fields, setFields] = useState<string[]>([]);
  const [isSavingEffects, setIsSavingEffects] = useState(false);
  const canEdit = Boolean(userData && canChangeContent(userData.role));

  return (
    <>
      <ContentBox
        title="Mass Edit"
        subtitle={subtitle}
        defaultBackHref={defaultBackHref}
      >
        <p>
          These tools are for efficient mass edit of content effects. Use the filter to
          find entries, select the effect fields to edit, then apply changes across many
          entries at once.
        </p>
      </ContentBox>
      <ContentBox
        title="Editor"
        subtitle="Select fields and edit"
        initialBreak
        topRightContent={
          <div className="flex items-center gap-2">
            {renderFilter(isSavingEffects)}
            <EffectFieldSelector
              selected={fields}
              setSelected={setFields}
              disabled={isSavingEffects}
            />
          </div>
        }
        padding={false}
      >
        {!canEdit && <div className="p-3">Not allowed.</div>}
        {canEdit && isFetching && <Loader explanation="Loading data" />}
        {canEdit && (
          <div ref={lastElementRef}>
            <MassEffectEditor
              {...editorProps}
              selectedFields={fields}
              onPendingChange={setIsSavingEffects}
            />
          </div>
        )}
      </ContentBox>
    </>
  );
};

type MassEffectEditorPageProps = Omit<
  ComponentProps<typeof MassEffectEditor>,
  "selectedFields" | "onPendingChange"
> & {
  subtitle: string;
  defaultBackHref: string;
  isFetching: boolean;
  lastElementRef: Ref<HTMLDivElement>;
  renderFilter: (disabled: boolean) => ReactNode;
};
