"use client";

import * as Sentry from "@sentry/nextjs";
import { Component, type ReactNode } from "react";
import { reloadIfOutdated } from "@/libs/buildVersion";

/**
 * Contains a failure to load or render on-demand code, typically a chunk download that
 * failed on a flaky network or one a newer deploy removed, so the rest of the app stays
 * mounted. A tab behind the deployed build reloads onto it; otherwise the error is
 * reported and `fallback` renders, with a retry that renders the children again.
 */
export class ChunkErrorBoundary extends Component<
  ChunkErrorBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (reloadIfOutdated()) return;
    Sentry.captureException(error);
  }

  retry = () => this.setState({ hasError: false });

  render() {
    return this.state.hasError ? this.props.fallback(this.retry) : this.props.children;
  }
}

interface ChunkErrorBoundaryProps {
  children: ReactNode;
  fallback: (retry: () => void) => ReactNode;
}
