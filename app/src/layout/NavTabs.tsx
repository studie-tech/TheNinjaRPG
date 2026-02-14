import type React from "react";
import { useEffect } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { cn } from "@/libs/shadui";

interface NavTabsProps {
  id?: string;
  className?: string;
  current: string | null;
  options: string[] | readonly string[];
  fontSize?: "text-xs" | "text-sm" | "text-base";
  setValue?: React.Dispatch<React.SetStateAction<any>>;
  onChange?: (value: string) => void;
}

const NavTabs: React.FC<NavTabsProps> = (props) => {
  // Destructure
  const { id, current, options, setValue, onChange } = props;

  // If we do not have a current value, get from localStorage or select first one
  useEffect(() => {
    if (!current && id) {
      const select = safeLocalStorageGetItem(id) || options[0];
      if (select) {
        if (setValue) setValue(select);
        if (onChange) onChange(select);
        safeLocalStorageSetItem(id, select);
      }
    }
  }, [id, current, options, setValue]);

  // Derived features
  const fontSize = props.fontSize ? props.fontSize : "text-sm";

  // Render
  return (
    <div
      className={`text-center ${fontSize} flex flex-row justify-center font-medium text-foreground`}
    >
      <ul className="-mb-px flex flex-row">
        {options.map((option, i) => (
          <li className="mr-2" key={`${option}-${i}`} id={`tutorial-${option}`}>
            <button
              type="button"
              className={cn(
                option === current
                  ? "active inline-block rounded-t-lg border-foreground/50 border-b-2 pt-2 pr-1 pb-2 pl-1 text-foreground/50"
                  : "inline-block rounded-t-lg border-gray-700 border-transparent border-b-2 pt-2 pr-1 pb-2 pl-1 hover:border-gray-300 hover:text-gray-600",
                props.className,
              )}
              onClick={() => {
                if (setValue) setValue(option);
                if (onChange) onChange(option);
                if (id) safeLocalStorageSetItem(id, option);
              }}
            >
              {option}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NavTabs;
