import type React from "react";

/** Render a sidebar heading with the desktop and mobile layout's text contrast. */
export const SideBannerTitle: React.FC<{
  children: React.ReactNode;
  break?: boolean;
}> = (props) => {
  return (
    <>
      {props.break && <br />}
      <p
        data-sidebar-title
        className="hidden px-1 pt-2 font-bold text-orange-100 text-xl md:block"
      >
        {props.children}
      </p>
      <p
        data-sidebar-title
        className="block px-1 pt-2 font-bold text-foreground text-xl md:hidden"
      >
        {props.children}
      </p>
    </>
  );
};
