"use client";

import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { getEffectiveColorTheme } from "@/libs/themePreference";

const Toaster = ({ ...props }: ToasterProps) => {
  // Get the current theme
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    return getEffectiveColorTheme();
  });

  useEffect(() => {
    const syncTheme = () => setTheme(getEffectiveColorTheme());
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("storage", syncTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

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
