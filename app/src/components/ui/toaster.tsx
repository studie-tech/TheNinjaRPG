"use client";

import { useState } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { getEffectiveColorTheme } from "@/libs/themePreference";

const Toaster = ({ ...props }: ToasterProps) => {
  // Get the current theme
  const [theme] = useState<"light" | "dark" | "system">(() => {
    return getEffectiveColorTheme();
  });

  // Feel free to tweak default props globally here.
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
          title: "md:block hidden",
        },
      }}
      {...props}
      position="top-right"
    />
  );
};

export { Toaster };
