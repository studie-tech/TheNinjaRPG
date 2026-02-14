"use client";

import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({ error, reset }) => {
  useEffect(() => {
    // Log the error to Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <ContentBox title="Something Went Wrong" defaultBackHref="/">
      <div className="flex flex-col items-center justify-center space-y-6 p-8">
        <div className="relative">
          <div className="absolute inset-0 animate-pulse rounded-full bg-red-500/20 blur-xl" />
          <AlertTriangle className="relative h-24 w-24 text-red-500" />
        </div>

        <div className="max-w-md space-y-3 text-center">
          <h2 className="font-bold text-red-500 text-xl">
            Oops! An unexpected error occurred
          </h2>
          <p className="text-muted-foreground">
            We&apos;ve been notified and are working to fix the issue. In the meantime,
            you can try refreshing the page or returning to the home page.
          </p>
          {error.digest && (
            <p className="font-mono text-muted-foreground/70 text-xs">
              Error ID: {error.digest}
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button onClick={reset} variant="default" size="lg" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
          <Link href="/">
            <Button variant="outline" size="lg" className="gap-2">
              <Home className="h-4 w-4" />
              Go Home
            </Button>
          </Link>
        </div>

        <details className="mt-4 w-full">
          <summary className="cursor-pointer text-muted-foreground text-sm transition-colors hover:text-foreground">
            Technical details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md border bg-popover p-4 text-xs">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>
      </div>
    </ContentBox>
  );
};

export default ErrorBoundary;
