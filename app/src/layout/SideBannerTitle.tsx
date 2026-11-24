import type React from "react";

/** Inherit sidebar contrast and follow the selected reading palette. */
export const SideBannerTitle: React.FC<{
  children: React.ReactNode;
  break?: boolean;
}> = (props) => {
  return (
    <>
      {props.break && <br />}
      <p
        data-sidebar-title
        data-reading-heading
        className="px-1 pt-2 text-xl font-bold text-inherit"
      >
        {props.children}
      </p>
    </>
  );
};
