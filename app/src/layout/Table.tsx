"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { Button } from "@/components/ui/button";
import AvatarImage from "@/layout/Avatar";
import { cn } from "@/libs/shadui";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { secondsPassed } from "@/utils/time";

export type ColumnDefinitionType<T, K extends keyof T> = {
  key: K;
  header: string;
  width?: number;
  onChange?: (id: string, column: string, value: string) => void;
  type:
    | "avatar"
    | "string"
    | "number"
    | "capitalized"
    | "time_passed"
    | "date"
    | "jsx"
    | "input";
  tooltip?: (row: T) => string;
};

type TableProps<T, K extends keyof T> = {
  data: Array<T> | undefined;
  columns: Array<ColumnDefinitionType<T, K>>;
  linkColumn?: K;
  linkPrefix?: string;
  buttons?: {
    label: string | React.ReactNode;
    onClick: (row: T) => void;
  }[];
  onRowClick?: (row: T) => void;
  setLastElement?: (element: HTMLDivElement | null) => void;
  /** Tighter padding and smaller avatars (e.g. modals, side panels). */
  compact?: boolean;
};

const Table = <T, K extends keyof T>(props: TableProps<T, K>) => {
  const { data, columns } = props;
  const router = useRouter();
  const compact = props.compact === true;
  const avatarSize = compact ? 36 : 100;
  const avatarWrap = compact ? "w-9" : "w-20";

  return (
    <div className="relative min-w-0 flex-1 overflow-x-scroll">
      <table className={cn("w-full text-left", compact ? "text-xs" : "text-sm")}>
        <thead
          className={cn(
            "bg-primary text-white uppercase",
            compact ? "text-[10px]" : "text-xs",
          )}
        >
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                scope="col"
                className={compact ? "px-2 py-1.5" : "px-3 py-3"}
              >
                {column.header}
              </th>
            ))}
            {props.buttons && (
              <th scope="col" className={compact ? "px-2 py-1.5" : "px-3 py-3"}>
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data?.map((row, i) => (
            <tr
              key={
                (row as T & { id?: string }).id
                  ? String((row as T & { id?: string }).id)
                  : `row-${i}`
              }
              ref={i === data.length - 1 ? props.setLastElement : null}
              className={`border-gray-700 border-b ${i % 2 === 0 ? "bg-card" : "bg-popover"} ${props.linkColumn || props.onRowClick ? "cursor-pointer hover:bg-poppopover" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                if (props.onRowClick) {
                  props.onRowClick(row);
                } else if (props.linkColumn) {
                  let route = row[props.linkColumn] as string;
                  route = props.linkPrefix ? props.linkPrefix + route : route;
                  router.push(route);
                }
              }}
            >
              {columns.map((column) => (
                <td
                  key={String(column.key)}
                  className={compact ? "px-2 py-1" : "px-3 py-2"}
                  style={{
                    width: column.width ? `${column.width}rem` : "auto",
                    minWidth: column.width ? `${column.width}rem` : "auto",
                  }}
                >
                  {column.type === "avatar" && (
                    <div className={avatarWrap}>
                      <AvatarImage
                        href={row[column.key] as string}
                        alt={row[column.key] as string}
                        size={avatarSize}
                        hover_effect={true}
                        priority
                      />
                    </div>
                  )}
                  {column.type === "input" && (
                    <AvatarImage
                      href={row[column.key] as string}
                      alt={row[column.key] as string}
                      size={avatarSize}
                      hover_effect={true}
                      priority
                    />
                  )}
                  {column.type === "string" && (
                    <div title={column.tooltip?.(row)}>{row[column.key] as string}</div>
                  )}
                  {column.type === "number" && (
                    <div title={column.tooltip?.(row)}>
                      {(row[column.key] as number).toLocaleString()}
                    </div>
                  )}
                  {column.type === "jsx" && (row[column.key] as React.ReactNode)}
                  {column.type === "capitalized" &&
                    capitalizeFirstLetter(row[column.key] as string)}
                  {column.type === "date" && (row[column.key] as Date).toLocaleString()}
                  {column.type === "time_passed" && (
                    <p>
                      {Math.floor(secondsPassed(row[column.key] as Date) / 60)}
                      <br />
                      minutes ago
                    </p>
                  )}
                </td>
              ))}
              {props.buttons && (
                <td className={compact ? "px-2 py-1" : "px-6 py-4"}>
                  {props.buttons.map((button) => (
                    <Button
                      id={`button-${button.label}`}
                      key={`button-${button.label}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        button.onClick(row);
                      }}
                    >
                      {button.label}
                    </Button>
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Table;
