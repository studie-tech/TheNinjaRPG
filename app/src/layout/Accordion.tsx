import type { LucideIcon } from "lucide-react";
import { ChevronsDown } from "lucide-react";
import type React from "react";
import { cn } from "@/libs/shadui";

interface AccordionProps {
  title: string;
  className?: string;
  selectedTitle: string;
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

  const active = title === props.selectedTitle;
  return (
    <div className={cn("border-b-2 px-3 py-1", props.className)}>
      <button
        type="button"
        className={cn(
          "flex w-full flex-row items-center text-left",
          active ? "" : "hover:cursor-pointer hover:bg-popover",
        )}
        onClick={() => !active && onClick(active ? "" : title)}
      >
        {Icon && (
          <div className="mr-3 flex shrink-0 items-center">
            <Icon className="text-muted-foreground h-5 w-5" />
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
          {props.options}
          <ChevronsDown
            className={`h-6 w-6 hover:cursor-pointer hover:text-orange-500 ${active ? "rotate-90 transform" : ""}`}
          />
        </div>
      </button>
      {active && children}
    </div>
  );
};

export default Accordion;
