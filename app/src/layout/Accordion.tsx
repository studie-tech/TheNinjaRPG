import type { LucideIcon } from "lucide-react";
import { ChevronsDown } from "lucide-react";
import type React from "react";
import { useId } from "react";
import { cn } from "@/libs/shadui";

interface AccordionProps {
  title: string;
  className?: string;
  selectedTitle: string;
  selectionKey?: string;
  collapsible?: boolean;
  /** Preserve drafts and timers when the panel is closed. */
  keepMounted?: boolean;
  titlePrefix?: string;
  titlePostfix?: string;
  unselectedSubtitle?: string | React.ReactNode;
  selectedSubtitle?: string | React.ReactNode;
  children: string | React.ReactNode;
  options?: React.ReactNode;
  icon?: LucideIcon;
  onClick: React.Dispatch<React.SetStateAction<string>>;
}

const Accordion: React.FC<AccordionProps> = (props) => {
  const { title, titlePrefix, titlePostfix } = props;
  const { unselectedSubtitle, selectedSubtitle, children, onClick } = props;
  const Icon = props.icon;
  const panelId = useId();

  const selectionKey = props.selectionKey ?? title;
  const active = selectionKey === props.selectedTitle;
  return (
    <div className={cn("border-b-2 px-3 py-1", props.className)}>
      <div className="flex items-center">
        <button
          type="button"
          className={cn(
            "flex w-full flex-row items-center text-left",
            active ? "" : "hover:cursor-pointer hover:bg-popover",
          )}
          aria-expanded={active}
          aria-controls={active || props.keepMounted ? panelId : undefined}
          onClick={() =>
            (!active || props.collapsible) && onClick(active ? "" : selectionKey)
          }
        >
          {Icon && (
            <div className="mr-3 flex shrink-0 items-center">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div>
            <h2 className="mt-2 font-bold">
              {titlePrefix}
              {title}
              {titlePostfix}
            </h2>
            <div className="italic">
              {active && selectedSubtitle}
              {!active && unselectedSubtitle}
            </div>
          </div>
          <div className="grow"></div>
          <div className="flex flex-row items-center">
            <ChevronsDown
              className={`h-6 w-6 hover:cursor-pointer hover:text-orange-500 ${active ? "rotate-90 transform" : ""}`}
            />
          </div>
        </button>
        {props.options && (
          <div className="flex shrink-0 items-center">{props.options}</div>
        )}
      </div>
      {(active || props.keepMounted) && (
        <div id={panelId} hidden={!active}>
          {children}
        </div>
      )}
    </div>
  );
};

export default Accordion;
