"use client";

import AvatarImage from "@/layout/Avatar";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { secondsPassed } from "@/utils/time";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import React from "react";

export type ColumnDefinitionType<T, K extends keyof T> = {
  key: K;
  header: string;
  width?: number;
  onChange?: (id: string, column: string, value: string) => void;
  type: "avatar" | "string" | "capitalized" | "time_passed" | "date" | "jsx" | "input";
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
  setLastElement?: (element: HTMLDivElement | null) => void;
};

const Table = <T, K extends keyof T>(props: TableProps<T, K>) => {
  const { data, columns } = props;
  const router = useRouter();

  return (
    <div className="relative flex-1 min-w-0 overflow-x-scroll">
      <table className="w-full text-left text-sm ">
        <thead className="bg-primary text-xs uppercase text-white">
          <tr>
            {columns.map((column, i) => (
              <th key={i} scope="col" className="px-3 py-3">
                {column.header}
              </th>
            ))}
            {props.buttons && (
              <th scope="col" className="px-3 py-3">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data?.map((row, i) => (
            <tr
              key={`row-${i}`}
              ref={i === data.length - 1 ? props.setLastElement : null}
              className={`border-b border-gray-700 ${
                i % 2 == 0 ? "bg-card" : "bg-popover"
              } ${props.linkColumn ? "cursor-pointer hover:bg-poppopover" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                if (props.linkColumn) {
                  let route = row[props.linkColumn] as string;
                  route = props.linkPrefix ? props.linkPrefix + route : route;
                  router.push(route);
                }
              }}
            >
              {columns.map((column, i) => (
                <td
                  key={`cell-${i}`}
                  className={`px-3 py-2`}
                  style={{
                    width: column.width ? `${column.width}rem` : "auto",
                    minWidth: column.width ? `${column.width}rem` : "auto",
                  }}
                >
                  {column.type === "avatar" && (
                    <div className="w-20">
                      <AvatarImage
                        href={row[column.key] as string}
                        alt={row[column.key] as string}
                        size={100}
                        hover_effect={true}
                        priority
                      />
                    </div>
                  )}
                  {column.type === "input" && (
                    <AvatarImage
                      href={row[column.key] as string}
                      alt={row[column.key] as string}
                      size={100}
                      hover_effect={true}
                      priority
                    />
                  )}
                  {column.type === "string" && (
                    <div title={column.tooltip?.(row)}>
                      {row[column.key] as string}
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
                <td className="px-6 py-4">
                  {props.buttons.map((button, i) => (
                    <Button
                      id={`button-${i}`}
                      key={`button-${i}`}
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
