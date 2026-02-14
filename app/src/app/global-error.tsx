"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Global error boundary that catches errors in the root layout.
 * Since this replaces the entire page including the layout,
 * we must include our own html/body tags and cannot use shared components.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
          color: "#f8fafc",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "2rem",
            maxWidth: "500px",
          }}
        >
          {/* Error Icon */}
          <div
            style={{
              width: "96px",
              height: "96px",
              margin: "0 auto 1.5rem",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(239, 68, 68, 0.2)",
                borderRadius: "50%",
                filter: "blur(20px)",
                animation: "pulse 2s ease-in-out infinite",
              }}
            />
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                width: "100%",
                height: "100%",
                position: "relative",
              }}
              aria-labelledby="error-icon-title"
            >
              <title id="error-icon-title">Error</title>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          {/* Title */}
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: "bold",
              color: "#ef4444",
              marginBottom: "0.75rem",
            }}
          >
            Critical Error
          </h1>

          {/* Description */}
          <p
            style={{
              color: "#94a3b8",
              marginBottom: "1.5rem",
              lineHeight: 1.6,
            }}
          >
            Something went seriously wrong. We&apos;ve been notified and are looking
            into it. Please try refreshing the page.
          </p>

          {/* Error ID */}
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#64748b",
                fontFamily: "monospace",
                marginBottom: "1.5rem",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}

          {/* Buttons */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                fontWeight: 500,
                color: "#fef3c7",
                background: "#78350f",
                border: "none",
                borderRadius: "0.5rem",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "#92400e";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "#78350f";
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = "#92400e";
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = "#78350f";
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Try Again
            </button>
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                fontWeight: 500,
                color: "#e2e8f0",
                background: "transparent",
                border: "1px solid #475569",
                borderRadius: "0.5rem",
                cursor: "pointer",
                textDecoration: "none",
                transition: "background 0.2s, border-color 0.2s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "rgba(71, 85, 105, 0.3)";
                e.currentTarget.style.borderColor = "#64748b";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "#475569";
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = "rgba(71, 85, 105, 0.3)";
                e.currentTarget.style.borderColor = "#64748b";
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "#475569";
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Go Home
            </a>
          </div>
        </div>

        {/* Pulse animation keyframes */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
          }
        `}</style>
      </body>
    </html>
  );
}
