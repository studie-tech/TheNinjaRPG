import { FileMinus, FilePlus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef } from "react";
import ContentBox from "@/layout/ContentBox";
import { EffectFormWrapper } from "@/layout/EditContent";
import { showUndoToast } from "@/libs/toast";
import { tagTypes, type ZodAllTags } from "@/validators/combat";

/** Editable list of effect tags with add/remove icons and an empty state. */
export const EffectTagListEditor: React.FC<EffectTagListEditorProps> = (props) => {
  const {
    effects,
    setEffects,
    newTag,
    tagTitle,
    tagSubtitle = "Control battle effects",
    emptyTitle,
    emptySubtitle,
    emptyText,
    disabled,
    lockStructure,
    ...formProps
  } = props;
  const validEffects = (effects?.filter((e) => e !== undefined) ?? []) as ZodAllTags[];
  // Undo re-inserts into the list as it is then, keeping edits made after the removal.
  const latestEffects = useRef(validEffects);
  useEffect(() => {
    latestEffects.current = validEffects;
  });
  const iconClassName = `h-6 w-6 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-orange-500"}`;

  const addTagIcon = (
    <FilePlus
      className={iconClassName}
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return;
        setEffects([...validEffects, newTag()]);
      }}
    />
  );

  return (
    <>
      {!lockStructure && validEffects.length === 0 && (
        <ContentBox
          title={emptyTitle}
          subtitle={emptySubtitle}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{addTagIcon}</div>}
        >
          {emptyText}
        </ContentBox>
      )}
      {validEffects.map((tag, i) => (
        <ContentBox
          key={`${tag.type}-${i}`}
          title={`${tagTitle} #${i + 1}`}
          subtitle={tagSubtitle}
          initialBreak={true}
          topRightContent={
            lockStructure ? undefined : (
              <div className="flex flex-row">
                {addTagIcon}
                <FileMinus
                  className={iconClassName}
                  aria-disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    const newEffects = [...validEffects];
                    const [removed] = newEffects.splice(i, 1);
                    setEffects(newEffects);
                    if (!removed) return;
                    showUndoToast(
                      `${tagTitle} #${i + 1} (${removed.type}) removed.`,
                      () => {
                        const current = [...latestEffects.current];
                        current.splice(Math.min(i, current.length), 0, removed);
                        setEffects(current);
                      },
                    );
                  }}
                />
              </div>
            )
          }
        >
          <EffectFormWrapper
            {...formProps}
            idx={i}
            tag={tag}
            availableTags={tagTypes}
            effects={validEffects}
            setEffects={setEffects}
          />
        </ContentBox>
      ))}
    </>
  );
};

type EffectFormProps = ComponentProps<typeof EffectFormWrapper>;

interface EffectTagListEditorProps
  extends Omit<
    EffectFormProps,
    "idx" | "tag" | "effects" | "availableTags" | "setEffects"
  > {
  /** Raw form value; useWatch types it as form input and it can hold undefined. */
  effects: readonly (object | undefined)[] | undefined;
  setEffects: (effects: ZodAllTags[]) => void;
  /** Placeholder appended by the add icon. */
  newTag: () => ZodAllTags;
  /** Per-tag box title, rendered as `<tagTitle> #<n>`. */
  tagTitle: string;
  tagSubtitle?: string;
  emptyTitle: string;
  emptySubtitle?: string;
  emptyText: ReactNode;
  /** Dim the add and remove icons and ignore their clicks. */
  disabled?: boolean;
  /** Hide add, remove and the empty state, leaving only the existing tags to edit. */
  lockStructure?: boolean;
}
