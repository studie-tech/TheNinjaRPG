"use client";

import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { type ColorTheme, getEffectiveColorTheme } from "@/libs/themePreference";

const Toaster = ({ ...props }: ToasterProps) => {
  // Follow the document's dark class, which every layout keeps current
  const [theme, setTheme] = useState<ColorTheme>(() => getEffectiveColorTheme());

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getEffectiveColorTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <SonnerToaster
      richColors
      visibleToasts={9}
      mobileOffset={{ bottom: "16px" }}
      className="toaster group"
      theme={theme}
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // An open modal dialog sets `pointer-events: none` on <body>, where toasts
          // render; they must stay clickable above it. Sonner's own rule for hidden
          // toasts is unlayered, so it still wins over this utility.
          toast: "pointer-events-auto",
          title: "md:block hidden",
        },
      }}
      {...props}
      position="top-right"
    />
  );
};

export { Toaster };
